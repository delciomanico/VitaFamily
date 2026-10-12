// Rate limiting em memória do portal da clínica (ADR-020: duplicado de
// `auth/domain/rate-limiter.ts` — mesma janela deslizante por processo único, sem Redis). Lógica
// pura, injeta `Clock`.
import type { Clock } from "../../../platform/clock/index.js";

export interface ClinicRateLimitRule {
  max: number;
  windowMs: number;
}

export interface ClinicRateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export class ClinicInMemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  peek(key: string, rule: ClinicRateLimitRule): ClinicRateLimitDecision {
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

  consume(key: string, rule: ClinicRateLimitRule): ClinicRateLimitDecision {
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
