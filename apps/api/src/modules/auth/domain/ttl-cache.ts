// Cache em memória com expiração (authentication.md §1/ADR-007: "estado da conta... verificado por
// pedido (cache ≤60 s)"). Lógica pura, injeta `Clock`.
import type { Clock } from "../../../platform/clock/index.js";

export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= this.clock.now().getTime()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: this.clock.now().getTime() + this.ttlMs });
  }

  /** Remove uma entrada imediatamente (ex.: depois de suspender a conta por ação administrativa). */
  invalidate(key: string): void {
    this.entries.delete(key);
  }
}
