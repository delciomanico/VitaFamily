import { describe, expect, it } from "vitest";
import { isValidLocalTime, parseLocalDate, parseLocalTime, zonedTimeToUtc } from "./clinic-slot-time.js";

describe("parseLocalDate", () => {
  it("devolve ano/mês/dia", () => {
    expect(parseLocalDate("2026-10-12")).toEqual({ year: 2026, month: 10, day: 12 });
  });

  it("recusa formato inválido", () => {
    expect(() => parseLocalDate("12-10-2026")).toThrow();
    expect(() => parseLocalDate("not-a-date")).toThrow();
  });
});

describe("isValidLocalTime/parseLocalTime", () => {
  it("aceita HH:mm válido", () => {
    expect(isValidLocalTime("09:30")).toBe(true);
    expect(parseLocalTime("09:30")).toEqual({ hour: 9, minute: 30 });
  });

  it("recusa formato inválido", () => {
    expect(isValidLocalTime("9:30")).toBe(false);
    expect(isValidLocalTime("24:00")).toBe(false);
    expect(() => parseLocalTime("24:00")).toThrow();
  });
});

describe("zonedTimeToUtc (DST, Europe/Lisbon, default de CLINIC_TIMEZONE)", () => {
  it("hora normal no inverno (WET, UTC+0)", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 1, day: 15, hour: 10, minute: 0 });
    expect(result.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("hora normal no verão (WEST, UTC+1)", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 7, day: 15, hour: 13, minute: 0 });
    expect(result.toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });

  it("hora inexistente (último domingo de março, salto 01:00->02:00) avança para a hora válida seguinte", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 });
    // 01:30 não existe; o instante devolvido corresponde a 02:30 WEST.
    expect(result.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("hora repetida (último domingo de outubro, recuo 02:00->01:00) devolve a primeira ocorrência", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 });
    // Primeira ocorrência: ainda em WEST (UTC+1) -> 00:30 UTC.
    expect(result.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("aceita outro fuso explícito (UTC, sem DST)", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, "UTC");
    expect(result.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
});
