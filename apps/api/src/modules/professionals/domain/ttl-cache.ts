// Cache em memória com expiração (≤60 s) do estado da conta do portal do profissional (BR-MKT-29).
import type { Clock } from "../../../platform/clock/index.js";

export class ProfessionalTtlCache<T> {
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

  invalidate(key: string): void {
    this.entries.delete(key);
  }
}
