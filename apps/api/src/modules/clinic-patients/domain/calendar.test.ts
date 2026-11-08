// TC-CLN-12: janela do calendário (≤31 dias), limites e ordem de pesquisa (BR-CLN-22/23).
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { assertWithinItemLimit, bookingMatches, CALENDAR_MAX_ITEMS, orderSearchBookings, parseCalendarWindow } from "./calendar.js";

describe("parseCalendarWindow", () => {
  it("aceita 31 dias exatos e janelas curtas", () => {
    expect(parseCalendarWindow("2026-11-01T00:00:00.000Z", "2026-12-02T00:00:00.000Z").to.toISOString()).toBe("2026-12-02T00:00:00.000Z");
    expect(() => parseCalendarWindow("2026-11-01T00:00:00.000Z", "2026-11-01T00:00:01.000Z")).not.toThrow();
  });
  it.each([
    ["to <= from", "2026-11-02T00:00:00.000Z", "2026-11-02T00:00:00.000Z"],
    ["to < from", "2026-11-02T00:00:00.000Z", "2026-11-01T00:00:00.000Z"],
    ["> 31 dias", "2026-11-01T00:00:00.000Z", "2026-12-02T00:00:00.001Z"],
    ["datas inválidas", "ontem", "amanhã"],
    ["em falta", undefined, undefined],
  ])("%s => VALIDATION_ERROR", (_label, from, to) => {
    expect(() => parseCalendarWindow(from, to)).toThrow(ValidationError);
  });
});

describe("limites e ordem", () => {
  it("máx. 2000 itens por lista", () => {
    expect(() => { assertWithinItemLimit(CALENDAR_MAX_ITEMS); }).not.toThrow();
    expect(() => { assertWithinItemLimit(CALENDAR_MAX_ITEMS + 1); }).toThrow(ValidationError);
  });
  it("pesquisa: futuras primeiro (crescente), depois passadas (mais recentes primeiro)", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    const at = (id: string, iso: string) => ({ id, startsAt: new Date(iso) });
    const ordered = orderSearchBookings([at("p1", "2026-11-01T10:00:00Z"), at("f2", "2026-11-10T10:00:00Z"), at("p2", "2026-11-05T10:00:00Z"), at("f1", "2026-11-09T10:00:00Z")], now);
    expect(ordered.map((e) => e.id)).toEqual(["f1", "f2", "p2", "p1"]);
  });
  it("bookingMatches: nome do paciente, serviço ou profissional (sem acentos)", () => {
    const norm = (v: string) => v.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
    const entry = { patientName: "Maria Conceição", specialty: "Cardiologia", professionalName: "Dr. Nuno" };
    expect(bookingMatches(entry, "conceicao", norm)).toBe(true);
    expect(bookingMatches(entry, "cardio", norm)).toBe(true);
    expect(bookingMatches(entry, "nuno", norm)).toBe(true);
    expect(bookingMatches({ ...entry, professionalName: null }, "zzz", norm)).toBe(false);
  });
});
