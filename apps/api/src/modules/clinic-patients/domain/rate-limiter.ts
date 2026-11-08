// Janela deslizante em memória, por processo (mesmo critério de `clinics`/`appointments`: processo único).
// Duplicada deliberadamente: nenhuma aresta nova no grafo de módulos. Sem I/O.
import type { Clock } from "../../../platform/clock/index.js";

export interface RateLimitRule {
  max: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterMs: number;
}

export interface RateLimiter {
  peek(key: string, rule: RateLimitRule): RateLimitDecision;
  consume(key: string, rule: RateLimitRule): RateLimitDecision;
}

/** BR-CLN-22: pesquisa/listagem — 60 pedidos/min por conta. */
export const SEARCH_ACCOUNT_RULE: RateLimitRule = { max: 60, windowMs: 60 * 1000 };
/** BR-CLN-29 (PROPOSTO): indicadores — 30 pedidos/min por conta. */
export const REPORT_ACCOUNT_RULE: RateLimitRule = { max: 30, windowMs: 60 * 1000 };
/** BR-CLN-20: partilhado com BR-CLN-10 (30/h por conta, 10 respostas 404/15 min, 60/h por IP); mesmas chaves do walk-in. */
export const LINK_ACCOUNT_RULE: RateLimitRule = { max: 30, windowMs: 60 * 60 * 1000 };
export const LINK_NOT_FOUND_RULE: RateLimitRule = { max: 10, windowMs: 15 * 60 * 1000 };
export const LINK_IP_RULE: RateLimitRule = { max: 60, windowMs: 60 * 60 * 1000 };

export class InMemoryRateLimiter implements RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  peek(key: string, rule: RateLimitRule): RateLimitDecision {
    const now = this.clock.now().getTime();
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > now - rule.windowMs);
    if (timestamps.length >= rule.max) {
      return { allowed: false, retryAfterMs: Math.max(0, (timestamps[0] ?? now) + rule.windowMs - now) };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

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
