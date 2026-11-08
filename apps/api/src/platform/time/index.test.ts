// Aritmética de dias civis em Europe/Lisbon (M14 Q: dia local, retorno, janela de indicadores), incl. DST e virada de dia.
import { describe, expect, it } from "vitest";
import { addDaysIso, addMonthsIso, diffDaysIso, isIsoDate, localDateIso, localDayWindow, localMidnightUtc } from "./index.js";

describe("localDateIso / localMidnightUtc (Europe/Lisbon)", () => {
  it.each([
    ["2026-01-15T23:30:00Z", "2026-01-15"],
    ["2026-07-15T22:59:59Z", "2026-07-15"],
    ["2026-07-15T23:00:00Z", "2026-07-16"], // verão: UTC+1, virada de dia local
    ["2026-03-29T00:59:59Z", "2026-03-29"],
  ])("%s -> dia local %s", (instant, expected) => {
    expect(localDateIso(new Date(instant))).toBe(expected);
  });

  it.each([
    ["2026-01-15", "2026-01-15T00:00:00.000Z"],
    ["2026-07-15", "2026-07-14T23:00:00.000Z"],
    ["2026-03-29", "2026-03-29T00:00:00.000Z"], // salto de março às 01:00 local; a meia-noite ainda é UTC+0
    ["2026-03-30", "2026-03-29T23:00:00.000Z"],
    ["2026-10-25", "2026-10-24T23:00:00.000Z"], // salto de outubro às 02:00 local
    ["2026-10-26", "2026-10-26T00:00:00.000Z"],
  ])("meia-noite local de %s = %s", (date, expected) => {
    expect(localMidnightUtc(date).toISOString()).toBe(expected);
  });

  it("o dia do salto de DST tem 23h (março) e 25h (outubro)", () => {
    const march = localDayWindow(new Date("2026-03-29T12:00:00Z"));
    expect((march.end.getTime() - march.start.getTime()) / 3_600_000).toBe(23);
    const october = localDayWindow(new Date("2026-10-25T12:00:00Z"));
    expect((october.end.getTime() - october.start.getTime()) / 3_600_000).toBe(25);
  });
});

describe("aritmética de datas", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-28"],
    ["2028-01-31", 1, "2028-02-29"],
    ["2026-08-31", 6, "2027-02-28"],
    ["2026-11-30", 3, "2027-02-28"],
    ["2026-12-15", 1, "2027-01-15"],
    ["2026-05-31", 24, "2028-05-31"],
  ])("%s + %i meses = %s", (from, months, expected) => {
    expect(addMonthsIso(from, months)).toBe(expected);
  });

  it("dias e diferenças", () => {
    expect(addDaysIso("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(diffDaysIso("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("isIsoDate rejeita datas impossíveis", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-2-3")).toBe(false);
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate(undefined)).toBe(false);
  });
});
