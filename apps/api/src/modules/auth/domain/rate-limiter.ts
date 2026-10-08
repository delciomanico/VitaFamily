// Rate limiting em memória (authentication.md §3, NFR-SEC-05): contadores por processo único da
// API (ADR-014, sem Redis). Lógica pura, injeta `Clock` (nunca `Date.now()` direto,
// conventions.md §2).
import type { Clock } from "../../../platform/clock/index.js";

export interface RateLimitRule {
  max: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Presente quando `allowed` é falso — para o cabeçalho `Retry-After`. */
  retryAfterMs: number;
}

/**
 * Janela deslizante por chave (ex.: `email+ip`, `ip`, `sessionId`). Faz limpeza passiva (só
 * guarda marcas de tempo dentro da janela); `prune()` remove chaves já sem marcas relevantes, para
 * o mapa não crescer sem limite (chamar periodicamente, ex.: job `auth.cleanup`).
 */
export class InMemoryRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly clock: Clock) {}

  /** Como `consume`, mas sem registar uma nova marca — usado para "espreitar" antes de agir. */
  peek(key: string, rule: RateLimitRule): RateLimitDecision {
    const now = this.clock.now().getTime();
    const windowStart = now - rule.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > windowStart);
    if (timestamps.length >= rule.max) {
      const oldest = timestamps[0] ?? now;
      return { allowed: false, retryAfterMs: Math.max(0, oldest + rule.windowMs - now) };
    }
    return { allowed: true, retryAfterMs: 0 };
  }

  /** Reinicia a janela de `key` (ex.: após uma autenticação bem-sucedida). */
  reset(key: string): void {
    this.hits.delete(key);
  }

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
