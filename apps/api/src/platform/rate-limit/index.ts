// Janela deslizante em memória, por processo (processo único da API). Reutilizável por qualquer módulo
// (`audit`, `clinic-receipts`…) sem criar arestas entre módulos. Sem I/O; o tempo vem da porta `Clock`.
import type { Clock } from "../clock/index.js";

export interface RateLimitRule {
  max: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimiter {
  consume(key: string, rule: RateLimitRule): RateLimitDecision;
}

export class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  consume(key: string, rule: RateLimitRule): RateLimitDecision {
    const now = this.clock.now().getTime();
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > now - rule.windowMs);
    if (timestamps.length >= rule.max) {
      this.hits.set(key, timestamps);
      return { allowed: false, retryAfterMs: Math.max(0, (timestamps[0] ?? now) + rule.windowMs - now) };
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, retryAfterMs: 0 };
  }
}
