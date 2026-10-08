import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { ageInYears, assertValidBirthDate, hasAccount, isMinor } from "./member.js";

const NOW = new Date("2026-10-08T10:00:00Z");

describe("ageInYears (BR-MEM-02)", () => {
  it.each([
    ["2008-10-08", 18], // faz 18 hoje
    ["2008-10-09", 17], // faz 18 amanhã
    ["1990-01-01", 36],
    ["2026-01-01", 0],
  ])("birthDate=%s -> %i anos", (birthDate, expected) => {
    expect(ageInYears(birthDate, NOW)).toBe(expected);
  });
});

describe("isMinor (BR-MEM-02)", () => {
  it.each([
    ["2009-01-01", true],
    ["2008-10-08", false], // 18 anos exatos hoje
    ["1990-01-01", false],
  ])("birthDate=%s -> isMinor=%s", (birthDate, expected) => {
    expect(isMinor(birthDate, NOW)).toBe(expected);
  });
});

describe("hasAccount", () => {
  it("verdadeiro com userId, falso sem", () => {
    expect(hasAccount({ userId: "u1" })).toBe(true);
    expect(hasAccount({ userId: undefined })).toBe(false);
  });
});

describe("assertValidBirthDate (BR-MEM-01)", () => {
  it("aceita data válida", () => {
    expect(() => {
      assertValidBirthDate("1990-01-01", NOW);
    }).not.toThrow();
  });

  it("rejeita data futura", () => {
    expect(() => {
      assertValidBirthDate("2030-01-01", NOW);
    }).toThrow(ValidationError);
  });

  it("rejeita data inválida", () => {
    expect(() => {
      assertValidBirthDate("not-a-date", NOW);
    }).toThrow(ValidationError);
  });

  it("rejeita mais de 120 anos", () => {
    expect(() => {
      assertValidBirthDate("1900-01-01", NOW);
    }).toThrow(ValidationError);
  });
});
