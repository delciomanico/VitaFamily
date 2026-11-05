import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { buildPatientDisplayName, normalizeWalkInEmail, WalkInInMemoryRateLimiter } from "./walk-in.js";

describe("normalizeWalkInEmail (BR-CLN-10)", () => {
  it("normaliza trim + minúsculas", () => {
    expect(normalizeWalkInEmail("  Maria.Silva@Example.PT ")).toBe("maria.silva@example.pt");
  });
  it.each(["", "   ", "sem-arroba", "a@b", "a b@c.pt", `${"a".repeat(250)}@x.pt`, 5, null])("rejeita %j (VALIDATION_ERROR)", (value) => {
    expect(() => normalizeWalkInEmail(value)).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }) as Error);
  });
});

describe("buildPatientDisplayName (ADR-024)", () => {
  it.each([
    ["Maria Santos Silva", "Maria S."],
    ["maria silva", "maria S."],
    ["  Ana   Óscar  ", "Ana Ó."],
    ["Beatriz", "Beatriz"],
    ["", ""],
  ])("%j -> %j", (input, expected) => {
    expect(buildPatientDisplayName(input)).toBe(expected);
  });
});

describe("WalkInInMemoryRateLimiter", () => {
  it("bloqueia ao exceder e liberta após a janela", () => {
    const clock = new FixedClock(new Date("2026-01-01T10:00:00Z"));
    const limiter = new WalkInInMemoryRateLimiter(clock);
    const rule = { max: 2, windowMs: 1000 };
    expect(limiter.consume("k", rule).allowed).toBe(true);
    expect(limiter.consume("k", rule).allowed).toBe(true);
    const blocked = limiter.consume("k", rule);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.peek("other", rule).allowed).toBe(true);
    clock.set(new Date("2026-01-01T10:00:02Z"));
    expect(limiter.consume("k", rule).allowed).toBe(true);
  });
});
