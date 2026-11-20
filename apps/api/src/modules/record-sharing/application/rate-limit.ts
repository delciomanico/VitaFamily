// Limites de taxa de `record-sharing` (BR-MKT-77; ADR-038): contadores na porta `RateLimiter` de `platform` (namespace `record-sharing`,
// Redis partilhado). Todas as chamadas são FECHADAS: se o suporte falhar, `RateLimiterUnavailableError` (503) sobe sem deixar passar o pedido.
import { RateLimitedError } from "../../../platform/errors/index.js";
import type { RateLimiter, RateLimitRule } from "../../../platform/rate-limit/async.js";

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** `subject` é sempre um id (UUID) ou ids unidos por hífen (só `[A-Za-z0-9-]`, sem PII). */
export const SHARE_RATE_LIMITS = {
  /** Opções, lista, detalhe e vistas (família), por utilizador. */
  "family-read": { max: 60, windowMs: MINUTE_MS },
  /** Lista e detalhe do profissional, por conta. */
  "professional-read": { max: 60, windowMs: MINUTE_MS },
  /** Abrir, por conta de profissional. */
  "open-minute": { max: 30, windowMs: MINUTE_MS },
  /** Abrir, por (conta, partilha): trava a leitura repetida em ciclo. */
  "open-share-day": { max: 120, windowMs: DAY_MS },
} as const satisfies Record<string, RateLimitRule>;

export type ShareLimit = keyof typeof SHARE_RATE_LIMITS;

/** Regista o pedido; `RateLimitedError` (429, `Retry-After`) se excede a regra. */
export async function enforceShareRate(limiter: RateLimiter, rule: ShareLimit, subject: string): Promise<void> {
  const decision = await limiter.consume({ rule, subject }, SHARE_RATE_LIMITS[rule]);
  if (!decision.allowed) throw new RateLimitedError(Math.max(1, decision.retryAfterMs));
}
