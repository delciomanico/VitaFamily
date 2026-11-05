// Cache em memória com expiração do estado da conta do portal (≤60 s, authorization.md §8.1 passo 1).
import type { Clock } from "../../../platform/clock/index.js";

export class InsuranceTtlCache<T> {
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

  /** Suspensão/reativação da seguradora afeta todas as suas contas: efeito imediato (BR-INS-10). */
  clear(): void {
    this.entries.clear();
  }
}
