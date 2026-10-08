// Relógio injetável (ADR-010): código de negócio nunca chama `new Date()`/`Date.now()` direto.

/** Porta: devolve o instante atual (sempre em UTC). */
export interface Clock {
  now(): Date;
}

/** Relógio real, usado em produção/desenvolvimento. */
export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

/** Relógio controlável para testes: fixo, avançável, redefinível. */
export class FixedClock implements Clock {
  private current: Date;

  constructor(initial: Date) {
    this.current = new Date(initial.getTime());
  }

  now(): Date {
    return new Date(this.current.getTime());
  }

  /** Avança o relógio por `ms` milissegundos. */
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  /** Fixa o relógio em `date`. */
  set(date: Date): void {
    this.current = new Date(date.getTime());
  }
}
