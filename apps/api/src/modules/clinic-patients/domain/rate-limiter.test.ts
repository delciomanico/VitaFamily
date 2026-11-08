// BR-CLN-22/20: janela deslizante com relógio injetável.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { InMemoryRateLimiter, SEARCH_ACCOUNT_RULE } from "./rate-limiter.js";

describe("InMemoryRateLimiter", () => {
  it("60/min: o 61.º é recusado com Retry-After; a janela desliza", () => {
    const clock = new FixedClock(new Date("2026-11-08T10:00:00Z"));
    const limiter = new InMemoryRateLimiter(clock);
    for (let i = 0; i < 60; i++) expect(limiter.consume("k", SEARCH_ACCOUNT_RULE).allowed).toBe(true);
    const denied = limiter.consume("k", SEARCH_ACCOUNT_RULE);
    expect(denied).toEqual({ allowed: false, retryAfterMs: 60_000 });
    expect(limiter.peek("k", SEARCH_ACCOUNT_RULE).allowed).toBe(false);
    clock.advance(60_001);
    expect(limiter.consume("k", SEARCH_ACCOUNT_RULE).allowed).toBe(true);
  });
  it("chaves independentes", () => {
    const limiter = new InMemoryRateLimiter(new FixedClock(new Date("2026-11-08T10:00:00Z")));
    for (let i = 0; i < 60; i++) limiter.consume("a", SEARCH_ACCOUNT_RULE);
    expect(limiter.consume("b", SEARCH_ACCOUNT_RULE).allowed).toBe(true);
  });
});
