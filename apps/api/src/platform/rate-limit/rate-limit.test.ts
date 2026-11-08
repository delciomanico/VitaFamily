import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "./index.js";

describe("InMemoryRateLimiter", () => {
  it("bloqueia ao exceder o máximo na janela e liberta depois", () => {
    let now = 1_000_000;
    const limiter = new InMemoryRateLimiter({ now: () => new Date(now) });
    const rule = { max: 2, windowMs: 60_000 };
    expect(limiter.consume("a", rule).allowed).toBe(true);
    expect(limiter.consume("a", rule).allowed).toBe(true);
    const blocked = limiter.consume("a", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBe(60_000);
    expect(limiter.consume("b", rule).allowed).toBe(true);
    now += 60_001;
    expect(limiter.consume("a", rule).allowed).toBe(true);
  });
});
