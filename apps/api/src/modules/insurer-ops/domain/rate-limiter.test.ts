import { describe, expect, it } from "vitest";
import type { Clock } from "../../../platform/clock/index.js";
import { InMemoryRateLimiter } from "./rate-limiter.js";

describe("InMemoryRateLimiter.shouldAuditDenial (auditoria de recusas, 1 por chave e janela)", () => {
  it("só devolve true uma vez por chave e janela; chaves distintas são independentes; renova depois da janela", () => {
    let t = 1_000_000;
    const clock: Clock = { now: () => new Date(t) };
    const limiter = new InMemoryRateLimiter(clock);
    const windowMs = 60_000;
    expect(limiter.shouldAuditDenial("a", windowMs)).toBe(true);
    expect(limiter.shouldAuditDenial("a", windowMs)).toBe(false);
    expect(limiter.shouldAuditDenial("b", windowMs)).toBe(true);
    t += windowMs - 1;
    expect(limiter.shouldAuditDenial("a", windowMs)).toBe(false);
    t += 1;
    expect(limiter.shouldAuditDenial("a", windowMs)).toBe(true);
  });
});
