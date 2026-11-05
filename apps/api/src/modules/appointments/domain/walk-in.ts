// Regras puras da marcação presencial pela clínica (D20, ADR-024, BR-CLN-10). Sem I/O.
import { ValidationError } from "../../../platform/errors/index.js";
import type { Clock } from "../../../platform/clock/index.js";

export interface WalkInRateLimitRule {
  max: number;
  windowMs: number;
}

export interface WalkInRateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

/** Janela deslizante em memória (mesmo critério de `clinics`/`auth`, processo único). */
export interface WalkInRateLimiter {
  peek(key: string, rule: WalkInRateLimitRule): WalkInRateLimitDecision;
  consume(key: string, rule: WalkInRateLimitRule): WalkInRateLimitDecision;
}

/** Limites PROPOSTOS (BR-CLN-10; OP-23): por conta 30 pesquisas+marcações/h, 10 respostas 404/15 min; por IP 60/h. */
export const WALK_IN_ACCOUNT_RULE: WalkInRateLimitRule = { max: 30, windowMs: 60 * 60 * 1000 };
export const WALK_IN_NOT_FOUND_RULE: WalkInRateLimitRule = { max: 10, windowMs: 15 * 60 * 1000 };
export const WALK_IN_IP_RULE: WalkInRateLimitRule = { max: 60, windowMs: 60 * 60 * 1000 };

export const WALK_IN_NOTES_MAX = 2000;
const EMAIL_MAX = 254;
// Forma mínima local@dominio.tld (o contrato já valida `format: email`; aqui só a rede de segurança).
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** BR-CLN-10: e-mail exato normalizado (trim + minúsculas), sem pesquisa parcial. Inválido => 422. */
export function normalizeWalkInEmail(raw: unknown, field = "email"): string {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (email.length === 0 || email.length > EMAIL_MAX || !EMAIL_SHAPE.test(email)) {
    throw new ValidationError([{ field, message: "e-mail inválido" }], { detail: "E-mail inválido." });
  }
  return email;
}

/** `displayName` mínimo (ADR-024): primeiro nome + inicial do último apelido, ex. "Maria S.". */
export function buildPatientDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined) {
    return "";
  }
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  const initial = last ? Array.from(last)[0] : undefined;
  return initial ? `${first} ${initial.toLocaleUpperCase("pt-PT")}.` : first;
}

/** Janela deslizante em memória, por processo (duplicado deliberado de `clinics`/`auth`: nenhuma aresta nova). */
export class WalkInInMemoryRateLimiter implements WalkInRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  peek(key: string, rule: WalkInRateLimitRule): WalkInRateLimitDecision {
    const now = this.clock.now().getTime();
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > now - rule.windowMs);
    if (timestamps.length >= rule.max) {
      const oldest = timestamps[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(0, oldest + rule.windowMs - now) };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  consume(key: string, rule: WalkInRateLimitRule): WalkInRateLimitDecision {
    const now = this.clock.now().getTime();
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > now - rule.windowMs);
    if (timestamps.length >= rule.max) {
      this.hits.set(key, timestamps);
      const oldest = timestamps[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(0, oldest + rule.windowMs - now) };
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, retryAfterMs: 0 };
  }
}
