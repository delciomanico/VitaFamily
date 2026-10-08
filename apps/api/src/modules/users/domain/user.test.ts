import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import {
  ageInYears,
  assertValidTimezone,
  normalizeEmail,
  termsReacceptanceRequired,
  type User,
} from "./user.js";

describe("normalizeEmail", () => {
  it("remove espaços e converte para minúsculas", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
});

describe("assertValidTimezone", () => {
  it("aceita um fuso IANA válido", () => {
    expect(() => { assertValidTimezone("Europe/Lisbon"); }).not.toThrow();
  });

  it("rejeita um fuso inválido com VALIDATION_ERROR", () => {
    expect(() => { assertValidTimezone("Not/AZone"); }).toThrow(ValidationError);
  });
});

describe("ageInYears", () => {
  it.each([
    { birthDate: "2008-10-08", reference: "2026-10-08T00:00:00Z", expected: 18 },
    { birthDate: "2008-10-09", reference: "2026-10-08T00:00:00Z", expected: 17 },
    { birthDate: "2000-01-01", reference: "2026-10-08T00:00:00Z", expected: 26 },
  ])("birthDate=$birthDate reference=$reference -> $expected", ({ birthDate, reference, expected }) => {
    expect(ageInYears(birthDate, new Date(reference))).toBe(expected);
  });
});

describe("termsReacceptanceRequired", () => {
  const baseUser: User = {
    id: "u1",
    email: "a@example.com",
    passwordHash: "hash",
    name: "Ana",
    birthDate: "1990-01-01",
    timezone: "Europe/Lisbon",
    status: "ACTIVE",
    platformRole: "NONE",
    termsAcceptedVersion: "1.0.0",
    termsAcceptedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  it("false quando a versão aceite é a atual", () => {
    expect(termsReacceptanceRequired(baseUser, "1.0.0")).toBe(false);
  });

  it("true quando a versão aceite difere da atual (B6)", () => {
    expect(termsReacceptanceRequired(baseUser, "2.0.0")).toBe(true);
  });
});
