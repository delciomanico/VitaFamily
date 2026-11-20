import { describe, expect, it } from "vitest";
import { CircuitBreaker } from "./circuit-breaker.js";

const THRESHOLD = 5;
const OPEN_MS = 5000;

function createBreaker() {
  let now = 0;
  const breaker = new CircuitBreaker({ threshold: THRESHOLD, openMs: OPEN_MS, nowMs: () => now });
  return {
    breaker,
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

function failTimes(breaker: CircuitBreaker, times: number): void {
  for (let i = 0; i < times; i += 1) {
    breaker.onFailure();
  }
}

describe("CircuitBreaker", () => {
  it("fechado deixa passar as chamadas", () => {
    const { breaker } = createBreaker();
    expect(breaker.isOpen).toBe(false);
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.tryAcquire()).toBe(true);
  });

  it("4 falhas seguidas não abrem o disjuntor; a 5.ª abre-o", () => {
    const { breaker } = createBreaker();

    failTimes(breaker, THRESHOLD - 1);
    expect(breaker.isOpen).toBe(false);
    expect(breaker.tryAcquire()).toBe(true);

    breaker.onFailure();
    expect(breaker.isOpen).toBe(true);
    expect(breaker.tryAcquire()).toBe(false);
  });

  it("aberto recusa tryAcquire antes de passarem 5000 ms", () => {
    const { breaker, advance } = createBreaker();
    failTimes(breaker, THRESHOLD);

    advance(OPEN_MS - 1);
    expect(breaker.tryAcquire()).toBe(false);
    expect(breaker.tryAcquire()).toBe(false);
  });

  it("após 5000 ms deixa passar uma só sonda e recusa a seguinte", () => {
    const { breaker, advance } = createBreaker();
    failTimes(breaker, THRESHOLD);

    advance(OPEN_MS);
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.tryAcquire()).toBe(false);
  });

  it("sonda com onFailure reabre o disjuntor por mais 5000 ms", () => {
    const { breaker, advance } = createBreaker();
    failTimes(breaker, THRESHOLD);

    advance(OPEN_MS);
    expect(breaker.tryAcquire()).toBe(true);
    breaker.onFailure();

    expect(breaker.isOpen).toBe(true);
    advance(OPEN_MS - 1);
    expect(breaker.tryAcquire()).toBe(false);

    advance(1);
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.tryAcquire()).toBe(false);
  });

  it("sonda com onSuccess fecha o disjuntor", () => {
    const { breaker, advance } = createBreaker();
    failTimes(breaker, THRESHOLD);

    advance(OPEN_MS);
    expect(breaker.tryAcquire()).toBe(true);
    breaker.onSuccess();

    expect(breaker.isOpen).toBe(false);
    expect(breaker.tryAcquire()).toBe(true);
    expect(breaker.tryAcquire()).toBe(true);
  });

  it("onSuccess a meio da sequência zera o contador de falhas", () => {
    const { breaker } = createBreaker();

    failTimes(breaker, THRESHOLD - 1);
    breaker.onSuccess();
    failTimes(breaker, THRESHOLD - 1);

    expect(breaker.isOpen).toBe(false);
    expect(breaker.tryAcquire()).toBe(true);

    breaker.onFailure();
    expect(breaker.isOpen).toBe(true);
  });
});
