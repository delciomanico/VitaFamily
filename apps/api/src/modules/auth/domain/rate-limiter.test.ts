import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { InMemoryRateLimiter } from "./rate-limiter.js";

describe("InMemoryRateLimiter", () => {
  it("permite até ao limite e recusa a seguir", () => {
    const clock = new FixedClock(new Date("2026-10-08T10:00:00Z"));
    const limiter = new InMemoryRateLimiter(clock);
    const rule = { max: 3, windowMs: 1000 };

    expect(limiter.consume("k", rule).allowed).toBe(true);
    expect(limiter.consume("k", rule).allowed).toBe(true);
    expect(limiter.consume("k", rule).allowed).toBe(true);
    const fourth = limiter.consume("k", rule);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).toBeGreaterThan(0);
  });

  it("liberta depois de a janela deslizar", () => {
    const clock = new FixedClock(new Date("2026-10-08T10:00:00Z"));
    const limiter = new InMemoryRateLimiter(clock);
    const rule = { max: 1, windowMs: 1000 };

    expect(limiter.consume("k", rule).allowed).toBe(true);
    expect(limiter.consume("k", rule).allowed).toBe(false);
    clock.advance(1001);
    expect(limiter.consume("k", rule).allowed).toBe(true);
  });

  it("chaves diferentes não interferem entre si", () => {
    const clock = new FixedClock(new Date("2026-10-08T10:00:00Z"));
    const limiter = new InMemoryRateLimiter(clock);
    const rule = { max: 1, windowMs: 1000 };

    expect(limiter.consume("a", rule).allowed).toBe(true);
    expect(limiter.consume("b", rule).allowed).toBe(true);
  });

  it("peek não consome: consultar repetidamente não bloqueia", () => {
    const clock = new FixedClock(new Date("2026-10-08T10:00:00Z"));
    const limiter = new InMemoryRateLimiter(clock);
    const rule = { max: 1, windowMs: 1000 };

    expect(limiter.peek("k", rule).allowed).toBe(true);
    expect(limiter.peek("k", rule).allowed).toBe(true);
    expect(limiter.consume("k", rule).allowed).toBe(true);
    expect(limiter.peek("k", rule).allowed).toBe(false);
  });

  it("reset limpa a janela de uma chave", () => {
    const clock = new FixedClock(new Date("2026-10-08T10:00:00Z"));
    const limiter = new InMemoryRateLimiter(clock);
    const rule = { max: 1, windowMs: 1000 };

    expect(limiter.consume("k", rule).allowed).toBe(true);
    expect(limiter.consume("k", rule).allowed).toBe(false);
    limiter.reset("k");
    expect(limiter.consume("k", rule).allowed).toBe(true);
  });

  it("prune remove chaves sem marcas recentes", () => {
    const clock = new FixedClock(new Date("2026-10-08T10:00:00Z"));
    const limiter = new InMemoryRateLimiter(clock);
    limiter.consume("k", { max: 5, windowMs: 1000 });
    clock.advance(2000);
    limiter.prune(1000);
    // depois do prune a chave "k" deve estar livre outra vez para 5 pedidos.
    const decision = limiter.consume("k", { max: 5, windowMs: 1000 });
    expect(decision.allowed).toBe(true);
  });
});
