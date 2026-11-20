// ADR-038 §5: relatórios/PDF falham fechados (503) se o suporte dos limitadores falhar; o 429 mantém-se.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { RateLimiterUnavailableError } from "../../../platform/rate-limit/async.js";
import { FailingRateLimiter } from "../../../platform/rate-limit/failing.js";
import { InMemoryRateLimiter } from "../../../platform/rate-limit/in-memory.js";
import { consumeLimit } from "./support.js";

describe("consumeLimit (clinic-reports)", () => {
  const clock = new FixedClock(new Date("2026-10-12T10:00:00Z"));

  it("503 com o limitador em falha", async () => {
    await expect(consumeLimit(new FailingRateLimiter(clock, "clinic-reports"), "pdf", "acc1")).rejects.toBeInstanceOf(RateLimiterUnavailableError);
  });

  it("429 ao exceder a bolsa pdf (30/min) e `write` é uma bolsa separada", async () => {
    const limiter = new InMemoryRateLimiter(clock, { namespace: "clinic-reports" });
    for (let i = 0; i < 30; i += 1) {
      await consumeLimit(limiter, "pdf", "acc1");
    }
    await expect(consumeLimit(limiter, "pdf", "acc1")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(consumeLimit(limiter, "write", "acc1")).resolves.toBeUndefined();
  });
});
