// Rate limiting em memória do portal do profissional (BR-MKT-13/30, authentication.md §5): janela deslizante por processo único,
// com `peek`/`reset` (login conta só as falhas). Duplicado de `clinics` (identidade separada; sem importar outros módulos).
import type { Clock } from "../../../platform/clock/index.js";

export interface ProfessionalRateLimitRule {
  max: number;
  windowMs: number;
}

export interface ProfessionalRateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export class ProfessionalInMemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  peek(key: string, rule: ProfessionalRateLimitRule): ProfessionalRateLimitDecision {
    const now = this.clock.now().getTime();
    const windowStart = now - rule.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= rule.max) {
      const oldest = timestamps[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(0, oldest + rule.windowMs - now) };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  consume(key: string, rule: ProfessionalRateLimitRule): ProfessionalRateLimitDecision {
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
