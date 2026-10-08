// Rate limiting em memória — cópia pequena e intencional de `auth/domain/rate-limiter.ts` (mesma
// justificação de `auth/domain/registration-rules.ts`: a superfície pública de `auth` não expõe
// esta classe, e duplicar ~70 linhas puras é mais barato do que acoplar os dois módulos por um
// detalhe de rate limiting). Usada só por `lookupInvitation` (PUBLIC, errors.md `RATE_LIMITED`).
import type { Clock } from "../../../platform/clock/index.js";

export interface RateLimitRule {
  max: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export class InMemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  consume(key: string, rule: RateLimitRule): RateLimitDecision {
    const now = this.clock.now().getTime();
    const windowStart = now - rule.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (timestamps.length >= rule.max) {
      this.hits.set(key, timestamps);
      const oldest = timestamps[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(0, oldest + rule.windowMs - now) };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Remove chaves sem marcas dentro de `maxAgeMs` (evita crescimento sem limite do mapa). */
  prune(maxAgeMs: number): void {
    const now = this.clock.now().getTime();
    const cutoff = now - maxAgeMs;
    for (const [key, timestamps] of this.hits) {
      const kept = timestamps.filter((t) => t > cutoff);
      if (kept.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, kept);
      }
    }
  }
}
