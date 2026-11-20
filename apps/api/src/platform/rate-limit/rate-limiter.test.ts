import { describe, expect, it } from "vitest";
import { SystemClock } from "../clock/index.js";
import { ServiceUnavailableError, toProblem } from "../errors/index.js";
import { runRateLimiterContract } from "./contract.js";
import { FailingRateLimiter } from "./failing.js";
import { InMemoryRateLimiter } from "./in-memory.js";
import { FailMode, RateLimiterUnavailableError } from "./port.js";

runRateLimiterContract("InMemoryRateLimiter", (namespace) => new InMemoryRateLimiter(new SystemClock(), { namespace }));

describe("política de falha (FailingRateLimiter)", () => {
  const rule = { max: 1, windowMs: 5_000 };
  const key = { rule: "login", subject: "u1" };

  it("FailMode fechado por omissão: 503 SERVICE_UNAVAILABLE com Retry-After 5, sem citar o Redis", async () => {
    const limiter = new FailingRateLimiter(new SystemClock());
    for (const call of [() => limiter.consume(key, rule), () => limiter.peek(key, rule, { failMode: FailMode.CLOSED })]) {
      const error = await call().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RateLimiterUnavailableError);
      expect(error).toBeInstanceOf(ServiceUnavailableError);
      const problem = toProblem(error, "req-1");
      expect(problem.status).toBe(503);
      expect(problem.body.code).toBe("SERVICE_UNAVAILABLE");
      expect(problem.retryAfterSeconds).toBe(5);
      expect(JSON.stringify(problem.body).toLowerCase()).not.toContain("redis");
    }
  });

  it("LOCAL_FALLBACK degrada para memória com a mesma regra", async () => {
    const limiter = new FailingRateLimiter(new SystemClock());
    expect((await limiter.consume(key, rule, { failMode: FailMode.LOCAL_FALLBACK })).allowed).toBe(true);
    expect((await limiter.consume(key, rule, { failMode: FailMode.LOCAL_FALLBACK })).allowed).toBe(false);
  });

  it("reset falha fechado (503) mesmo com LOCAL_FALLBACK noutras chamadas", async () => {
    const limiter = new FailingRateLimiter(new SystemClock());
    const error = await limiter.reset(key).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimiterUnavailableError);
    expect(toProblem(error, "req-1").status).toBe(503);
  });
});
