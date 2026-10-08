import { describe, expect, it } from "vitest";
import { INVITATION_TTL_DAYS, canTransition, computeExpiresAt, isExpired } from "./invitation.js";

describe("computeExpiresAt/isExpired (R3/BR-MEM-12)", () => {
  it(`expira ${String(INVITATION_TTL_DAYS)} dias depois da criação`, () => {
    const createdAt = new Date("2026-10-01T00:00:00Z");
    const expiresAt = computeExpiresAt(createdAt);
    expect(expiresAt.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it.each([
    [new Date("2026-10-07T23:59:59Z"), false],
    [new Date("2026-10-08T00:00:00Z"), true],
    [new Date("2026-10-09T00:00:00Z"), true],
  ])("now=%s -> isExpired=%s", (now, expected) => {
    expect(isExpired({ expiresAt: new Date("2026-10-08T00:00:00Z") }, now)).toBe(expected);
  });
});

describe("canTransition (state-machines.md Invitation)", () => {
  it.each([
    ["PENDING", "ACCEPTED", true],
    ["PENDING", "REVOKED", true],
    ["PENDING", "EXPIRED", true],
    ["PENDING", "PENDING", false],
    ["ACCEPTED", "REVOKED", false],
    ["REVOKED", "ACCEPTED", false],
    ["EXPIRED", "ACCEPTED", false],
  ] as const)("%s -> %s = %s", (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected);
  });
});
