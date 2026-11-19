// Limitador de janela deslizante em memória por chave (BR-MKT-66: consulta de horários ≤ 60/min por utilizador). Relógio injetado.
import type { ConsultationsClock } from "./ports.js";

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly clock: ConsultationsClock,
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Regista o pedido; `null` se cabe, senão os ms até poder repetir. */
  hit(key: string): number | null {
    const now = this.clock.now().getTime();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, (recent[0] ?? now) + this.windowMs - now);
    }
    recent.push(now);
    this.hits.set(key, recent);
    return null;
  }

  /** Poda as chaves sem pedidos recentes (evita crescimento sem limite). */
  prune(): void {
    const now = this.clock.now().getTime();
    for (const [key, times] of this.hits) {
      if (!times.some((t) => now - t < this.windowMs)) this.hits.delete(key);
    }
  }
}
