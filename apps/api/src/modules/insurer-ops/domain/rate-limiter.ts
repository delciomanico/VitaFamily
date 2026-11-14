// Rate limiting em memória por processo (janela deslizante); duplicado deliberadamente dos outros módulos (sem importar
// `auth`/`clinics`/`insurance`). Lógica pura, injeta `Clock`. Valores de elegibilidade abaixo: defaults conservadores
// (security.md não os fixa — a ratificar).
import type { Clock } from "../../../platform/clock/index.js";

export interface RateLimitRule {
  max: number;
  windowMs: number;
}

/** BR-SEG-18: por conta de clínica e por IP, em 10 min (cada validação conta, incl. `eligible:false`). */
export const ELIGIBILITY_RATE_LIMITS: { account: RateLimitRule; ip: RateLimitRule } = {
  account: { max: 30, windowMs: 10 * 60 * 1000 },
  ip: { max: 60, windowMs: 10 * 60 * 1000 },
};

/**
 * App do paciente (defaults conservadores, a ratificar). Reclamar cartão: cada tentativa conta (também as recusadas — trava a
 * força bruta do código); QR: por utilizador e cartão.
 */
export const CLAIM_RATE_LIMITS: { user: RateLimitRule; ip: RateLimitRule } = {
  user: { max: 10, windowMs: 15 * 60 * 1000 },
  ip: { max: 30, windowMs: 15 * 60 * 1000 },
};
export const QR_RATE_LIMIT: RateLimitRule = { max: 20, windowMs: 10 * 60 * 1000 };

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

const MAX_TRACKED_KEYS = 5000;

export class InMemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();
  /** Instante a partir do qual a chave já não pesa (fim da janela do último uso): permite varrer chaves antigas. */
  private readonly expiresAt = new Map<string, number>();

  private readonly deniedUntil = new Map<string, number>();

  constructor(private readonly clock: Clock) {}

  private recent(key: string, rule: RateLimitRule, now: number): number[] {
    return (this.hits.get(key) ?? []).filter((t) => t > now - rule.windowMs);
  }

  /** Decide sem registar. */
  peek(key: string, rule: RateLimitRule): RateLimitDecision {
    const now = this.clock.now().getTime();
    const timestamps = this.recent(key, rule, now);
    if (timestamps.length >= rule.max) return { allowed: false, retryAfterMs: Math.max(1, (timestamps[0] ?? now) + rule.windowMs - now) };
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Regista um uso (chamar só depois de `peek` permitir). */
  record(key: string, rule: RateLimitRule): void {
    const now = this.clock.now().getTime();
    const timestamps = this.recent(key, rule, now);
    timestamps.push(now);
    this.hits.set(key, timestamps);
    this.expiresAt.set(key, now + rule.windowMs);
    if (this.hits.size > MAX_TRACKED_KEYS) this.sweep(now);
  }

  /**
   * Auditoria de recusas: `true` no máximo uma vez por chave e janela (evita inflar `audit_logs` sob ataque); o chamador só
   * regista o `DENIED/RATE_LIMITED` quando devolve `true`.
   */
  shouldAuditDenial(key: string, windowMs: number): boolean {
    const now = this.clock.now().getTime();
    const until = this.deniedUntil.get(`denied:${key}`) ?? 0;
    if (until > now) return false;
    this.deniedUntil.set(`denied:${key}`, now + windowMs);
    this.expiresAt.set(`denied:${key}`, now + windowMs);
    if (this.deniedUntil.size > MAX_TRACKED_KEYS) this.sweep(now);
    return true;
  }

  /** Sem isto o mapa cresceria com cada utilizador/IP/cartão visto (fuga de memória lenta). */
  private sweep(now: number): void {
    for (const [key, until] of this.expiresAt) {
      if (until <= now) {
        this.expiresAt.delete(key);
        this.hits.delete(key);
        this.deniedUntil.delete(key);
      }
    }
  }
}
