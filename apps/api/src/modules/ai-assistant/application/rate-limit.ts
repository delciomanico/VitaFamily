// Limites de taxa do assistente (BR-AI-13: 20/hora e 100/dia por utilizador nas sessões; 20/hora no consentimento; ADR-038). Fechado: se o suporte
// falhar, `RateLimiterUnavailableError` (503) sobe e o pedido não passa. `subject` é sempre o id do utilizador (UUID, sem PII).
import { RateLimitedError } from "../../../platform/errors/index.js";
import type { RateLimiter, RateLimitRule } from "../../../platform/rate-limit/async.js";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const AI_RATE_LIMITS = {
  "session-hour": { max: 20, windowMs: HOUR_MS },
  "session-day": { max: 100, windowMs: DAY_MS },
  "consent-hour": { max: 20, windowMs: HOUR_MS },
  read: { max: 60, windowMs: MINUTE_MS },
} as const satisfies Record<string, RateLimitRule>;

export type AiLimit = keyof typeof AI_RATE_LIMITS;

export async function enforceAiRate(limiter: RateLimiter, rule: AiLimit, subject: string): Promise<void> {
  const decision = await limiter.consume({ rule, subject }, AI_RATE_LIMITS[rule]);
  if (!decision.allowed) throw new RateLimitedError(Math.max(1, decision.retryAfterMs));
}
