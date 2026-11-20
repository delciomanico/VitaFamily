// Disjuntor (ADR-038 §5): após `threshold` falhas seguidas, falha imediata durante `openMs`; depois deixa
// passar uma sonda de cada vez (meio-aberto). Sem I/O; o tempo é injetado (monotónico, em ms).
export interface CircuitBreakerOptions {
  threshold: number;
  openMs: number;
  nowMs: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;

  constructor(private readonly options: CircuitBreakerOptions) {}

  /** `true` se a chamada pode avançar (fechado, ou sonda única em meio-aberto). */
  tryAcquire(): boolean {
    if (this.openedAt === null) {
      return true;
    }
    if (this.options.nowMs() - this.openedAt < this.options.openMs || this.probing) {
      return false;
    }
    this.probing = true;
    return true;
  }

  onSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  onFailure(): void {
    this.failures += 1;
    if (this.openedAt !== null || this.failures >= this.options.threshold) {
      this.openedAt = this.options.nowMs();
    }
    this.probing = false;
  }

  get isOpen(): boolean {
    return this.openedAt !== null;
  }
}
