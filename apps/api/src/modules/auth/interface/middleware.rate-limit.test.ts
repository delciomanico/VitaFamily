// Limite geral por ator (ADR-038 §5): GET/HEAD degradam para memória local; escritas falham fechadas (503).
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { FailingRateLimiter } from "../../../platform/rate-limit/failing.js";
import { RateLimiterUnavailableError } from "../../../platform/rate-limit/async.js";
import { createActorContextMiddleware } from "./middleware.js";

function run(method: string, limiter: FailingRateLimiter): Promise<unknown> {
  const middleware = createActorContextMiddleware({
    resolveActorState: () =>
      Promise.resolve({
        userId: "u1",
        sessionId: "s1",
        platformAdmin: false,
        suspended: false,
        termsReacceptanceRequired: false,
      }),
    generalRateLimiter: limiter,
  });
  const req = { method, authSubject: { userId: "u1", sessionId: "s1" }, openapi: undefined } as unknown as Request;
  return new Promise((resolve) => {
    const next: NextFunction = (error?: unknown) => {
      resolve(error);
    };
    middleware(req, {} as Response, next);
  });
}

describe("limite geral com o limitador em falha", () => {
  const clock = new FixedClock(new Date("2026-10-08T10:00:00Z"));

  it.each(["GET", "HEAD"])("%s: degrada para memória e segue", async (method) => {
    expect(await run(method, new FailingRateLimiter(clock, "auth"))).toBeUndefined();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])("%s: falha fechada (503)", async (method) => {
    expect(await run(method, new FailingRateLimiter(clock, "auth"))).toBeInstanceOf(RateLimiterUnavailableError);
  });
});
