// Adaptador em memória (testes e dev sem Redis; proibido em produção, ver config). Janela deslizante exata;
// o tempo vem da porta `Clock`.
import type { Clock } from "../clock/index.js";
import { NamespacedRateLimiter, type NamespacedRateLimiterOptions } from "./limiter.js";
import type { RateLimitDecision, RateLimitRule, RateLimitStore } from "./port.js";

const SWEEP_THRESHOLD = 10_000;

export class InMemoryRateLimitStore implements RateLimitStore {
  private readonly hits = new Map<string, { timestamps: number[]; windowMs: number }>();

  constructor(private readonly clock: Clock) {}

  consume(fullKey: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    return Promise.resolve(this.apply(fullKey, rule, true));
  }

  peek(fullKey: string, rule: RateLimitRule): Promise<RateLimitDecision> {
    return Promise.resolve(this.apply(fullKey, rule, false));
  }

  private apply(fullKey: string, rule: RateLimitRule, record: boolean): RateLimitDecision {
    const now = this.clock.now().getTime();
    if (this.hits.size > SWEEP_THRESHOLD) {
      this.sweep(now);
    }
    const timestamps = (this.hits.get(fullKey)?.timestamps ?? []).filter((t) => t > now - rule.windowMs);
    if (timestamps.length >= rule.max) {
      this.hits.set(fullKey, { timestamps, windowMs: rule.windowMs });
      return { allowed: false, retryAfterMs: Math.max(0, (timestamps[0] ?? now) + rule.windowMs - now) };
    }
    if (record) {
      timestamps.push(now);
      this.hits.set(fullKey, { timestamps, windowMs: rule.windowMs });
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.hits) {
      if (!entry.timestamps.some((t) => t > now - entry.windowMs)) {
        this.hits.delete(key);
      }
    }
  }
}

export class InMemoryRateLimiter extends NamespacedRateLimiter {
  constructor(clock: Clock, options: Partial<Pick<NamespacedRateLimiterOptions, "namespace" | "prefix" | "secret">> = {}) {
    super({
      store: new InMemoryRateLimitStore(clock),
      namespace: options.namespace ?? "default",
      prefix: options.prefix ?? "vita:memory",
      secret: options.secret ?? "in-memory-rate-limiter-secret-not-for-production",
      fallbackStore: new InMemoryRateLimitStore(clock),
    });
  }
}
