// Rate limiting em memória do portal da seguradora (duplicado deliberado de `clinics`/`auth`;
// janela deslizante por processo único). Lógica pura, injeta `Clock`.
import type { Clock } from "../../../platform/clock/index.js";

export interface InsuranceRateLimitRule {
  max: number;
  windowMs: number;
}

export interface InsuranceRateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export class InsuranceInMemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  private recent(key: string, rule: InsuranceRateLimitRule, now: number): number[] {
    return (this.hits.get(key) ?? []).filter((t) => t > now - rule.windowMs);
  }

  peek(key: string, rule: InsuranceRateLimitRule): InsuranceRateLimitDecision {
    const now = this.clock.now().getTime();
    const timestamps = this.recent(key, rule, now);
    if (timestamps.length >= rule.max) {
      return { allowed: false, retryAfterMs: Math.max(0, (timestamps[0] ?? now) + rule.windowMs - now) };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }

  consume(key: string, rule: InsuranceRateLimitRule): InsuranceRateLimitDecision {
    const now = this.clock.now().getTime();
    const timestamps = this.recent(key, rule, now);
    if (timestamps.length >= rule.max) {
      this.hits.set(key, timestamps);
      return { allowed: false, retryAfterMs: Math.max(0, (timestamps[0] ?? now) + rule.windowMs - now) };
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, retryAfterMs: 0 };
  }
}
