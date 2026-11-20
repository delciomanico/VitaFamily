// Limites de taxa de `consultations` (BR-MKT-66; ADR-038): contadores na porta `RateLimiter` de `platform`
// (namespace `consultations`, Redis partilhado). Todas as chamadas são FECHADAS: se o suporte falhar,
// `RateLimiterUnavailableError` (503) sobe sem deixar passar o pedido.
import { RateLimitedError } from "../../../platform/errors/index.js";
import type { RateLimiter, RateLimitRule } from "../../../platform/rate-limit/async.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Regras (valores inalterados desde MK3). `subject` é sempre um id (UUID de utilizador ou de conta profissional). */
export const CONSULTATION_LIMITS = {
  /** Horários reserváveis, por utilizador. */
  "booking-slots": { max: 60, windowMs: MINUTE_MS },
  /** Lista de comprovativos (família). */
  "proof-list": { max: 60, windowMs: MINUTE_MS },
  /** Upload de comprovativos (família). */
  "proof-upload": { max: 20, windowMs: HOUR_MS },
  /** Download de comprovativo (família). */
  "proof-download": { max: 60, windowMs: MINUTE_MS },
  /** Download de comprovativo (profissional). */
  "professional-proof-download": { max: 60, windowMs: MINUTE_MS },
  /** Download de comprovativo em disputa (admin). */
  "admin-dispute-download": { max: 60, windowMs: MINUTE_MS },
  /** Avaliações escritas, por utilizador. */
  "review-write": { max: 20, windowMs: DAY_MS },
  /** Avaliações públicas (leitura), por utilizador. */
  "review-public": { max: 60, windowMs: MINUTE_MS },
  /** Denúncias de avaliações, por conta profissional. */
  "review-report": { max: 10, windowMs: DAY_MS },
} as const satisfies Record<string, RateLimitRule>;

export type ConsultationLimit = keyof typeof CONSULTATION_LIMITS;

/** Regista o pedido; `RateLimitedError` (429, `Retry-After`) se excede a regra. */
export async function enforceRate(limiter: RateLimiter, rule: ConsultationLimit, subject: string): Promise<void> {
  const decision = await limiter.consume({ rule, subject }, CONSULTATION_LIMITS[rule]);
  if (!decision.allowed) throw new RateLimitedError(Math.max(1, decision.retryAfterMs));
}
