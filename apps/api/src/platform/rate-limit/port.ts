// Porta assíncrona `RateLimiter` (ADR-038, ADR-015): o contrato é do núcleo; o Redis é só um adaptador
// (`infrastructure/`). Convive com o limitador síncrono histórico de `index.ts` até às fatias RL3..RL7.
import { ServiceUnavailableError } from "../errors/index.js";
import type { RateLimitDecision, RateLimitRule } from "./index.js";

export type { RateLimitDecision, RateLimitRule };

/** O que acontece quando o suporte (Redis) falha. `CLOSED` por omissão: nunca se deixa passar (ADR-038 §5). */
export const FailMode = {
  CLOSED: "CLOSED",
  LOCAL_FALLBACK: "LOCAL_FALLBACK",
} as const;
export type FailMode = (typeof FailMode)[keyof typeof FailMode];

/**
 * Chave lógica de um contador. `rule` identifica a regra (ex.: "login"), `subject` o sujeito.
 * `pii: true` (e-mail, IP) faz o adaptador guardar `HMAC-SHA256(RATE_LIMIT_KEY_SECRET, subject)`; ids (UUID) vão em claro.
 */
export interface RateLimitKey {
  rule: string;
  subject: string;
  pii?: boolean;
}

export interface RateLimitCallOptions {
  failMode?: FailMode;
}

export interface RateLimiter {
  /** Regista um pedido e decide. */
  consume(key: RateLimitKey, rule: RateLimitRule, options?: RateLimitCallOptions): Promise<RateLimitDecision>;
  /** Lê sem registar (falhas de login, 404 do walk-in). */
  peek(key: RateLimitKey, rule: RateLimitRule, options?: RateLimitCallOptions): Promise<RateLimitDecision>;
}

/** Suporte dos contadores (adaptador). Chave já completa; só o núcleo a constrói. */
export interface RateLimitStore {
  consume(fullKey: string, rule: RateLimitRule): Promise<RateLimitDecision>;
  peek(fullKey: string, rule: RateLimitRule): Promise<RateLimitDecision>;
}

/** Falha do suporte (Redis inacessível, timeout, erro do script, disjuntor aberto). */
export class RateLimitStoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RateLimitStoreError";
  }
}

/** `Retry-After` do 503 por falha do limitador (ADR-038 §6). */
export const RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_MS = 5_000;

/** 503 SERVICE_UNAVAILABLE + `Retry-After: 5`; `detail` genérico, sem referir o Redis. */
export class RateLimiterUnavailableError extends ServiceUnavailableError {
  constructor(options: { cause?: unknown } = {}) {
    super({
      detail: "Serviço temporariamente indisponível. Tente novamente dentro de instantes.",
      retryAfterMs: RATE_LIMIT_UNAVAILABLE_RETRY_AFTER_MS,
      cause: options.cause,
    });
    this.name = "RateLimiterUnavailableError";
  }
}
