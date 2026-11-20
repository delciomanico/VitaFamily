import { describe, expect, it } from "vitest";
import { buildPatientDisplayName, normalizeWalkInEmail } from "./walk-in.js";

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
