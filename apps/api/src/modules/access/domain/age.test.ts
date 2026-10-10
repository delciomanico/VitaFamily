import { describe, expect, it } from "vitest";
import { isAdultAt } from "./age.js";

describe("isAdultAt", () => {
  it.each([
    ["2008-01-15", "2026-01-14", false], // falta 1 dia para os 18
    ["2008-01-15", "2026-01-15", true], // faz 18 anos hoje
    ["2008-01-15", "2026-06-01", true],
    ["2012-01-01", "2026-01-01", false], // 14 anos
  ])("isAdultAt(%s, %s) -> %s", (birthDate, now, expected) => {
    expect(isAdultAt(birthDate, new Date(`${now}T00:00:00.000Z`))).toBe(expected);
  });
});
