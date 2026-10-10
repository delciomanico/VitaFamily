import { describe, expect, it } from "vitest";
import { DomainError } from "../../../platform/errors/index.js";
import { assertValidPlanTransition, assertValidSchedule, type ScheduleCandidate } from "./medication-plan.js";

const startAt = new Date("2026-01-01T00:00:00.000Z");

function baseFixed(overrides: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
  return { scheduleType: "FIXED_TIMES", times: ["08:00", "20:00"], startAt, continuous: true, ...overrides };
}

function baseInterval(overrides: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
  return { scheduleType: "INTERVAL", intervalHours: 8, startAt, continuous: true, ...overrides };
}

describe("assertValidSchedule — FIXED_TIMES", () => {
  it("aceita horários válidos, contínuo", () => {
    expect(assertValidSchedule(baseFixed())).toEqual({ times: ["08:00", "20:00"], daysOfWeek: [], continuous: true });
  });

  it("aceita com data de fim (não contínuo)", () => {
    const endAt = new Date("2026-02-01T00:00:00.000Z");
    expect(assertValidSchedule(baseFixed({ continuous: false, endAt }))).toEqual({
      times: ["08:00", "20:00"],
      daysOfWeek: [],
      continuous: false,
      endAt,
    });
  });

  it("recusa sem horários", () => {
    expect(() => assertValidSchedule(baseFixed({ times: [] }))).toThrow(DomainError);
  });

  it("recusa horário malformado", () => {
    expect(() => assertValidSchedule(baseFixed({ times: ["8:00"] }))).toThrow(DomainError);
  });

  it("recusa dia da semana fora de 1-7", () => {
    expect(() => assertValidSchedule(baseFixed({ daysOfWeek: [0] }))).toThrow(DomainError);
    expect(() => assertValidSchedule(baseFixed({ daysOfWeek: [8] }))).toThrow(DomainError);
  });

  it("recusa intervalHours num plano de horários fixos", () => {
    expect(() => assertValidSchedule(baseFixed({ intervalHours: 6 }))).toThrow(DomainError);
  });

  it("recusa contínuo e endAt em simultâneo", () => {
    expect(() => assertValidSchedule(baseFixed({ continuous: true, endAt: new Date("2026-02-01T00:00:00.000Z") }))).toThrow(DomainError);
  });

  it("recusa nem contínuo nem endAt", () => {
    expect(() => assertValidSchedule(baseFixed({ continuous: false }))).toThrow(DomainError);
  });

  it("recusa endAt anterior ou igual ao início", () => {
    expect(() => assertValidSchedule(baseFixed({ continuous: false, endAt: startAt }))).toThrow(DomainError);
  });
});

describe("assertValidSchedule — INTERVAL", () => {
  it("aceita intervalo válido", () => {
    expect(assertValidSchedule(baseInterval())).toEqual({ intervalHours: 8, continuous: true });
  });

  it.each([0, -1, 169, 1.5])("recusa intervalo fora de 1-168 (%s)", (intervalHours) => {
    expect(() => assertValidSchedule(baseInterval({ intervalHours }))).toThrow(DomainError);
  });

  it("recusa sem intervalHours", () => {
    expect(() => assertValidSchedule(baseInterval({ intervalHours: null }))).toThrow(DomainError);
  });

  it("recusa horários num plano de intervalo", () => {
    expect(() => assertValidSchedule(baseInterval({ times: ["08:00"] }))).toThrow(DomainError);
  });

  it("recusa dias da semana num plano de intervalo", () => {
    expect(() => assertValidSchedule(baseInterval({ daysOfWeek: [1] }))).toThrow(DomainError);
  });
});

describe("assertValidPlanTransition (ST1)", () => {
  it("permite ACTIVE->ENDED e ENDED->ACTIVE", () => {
    expect(() => { assertValidPlanTransition("ACTIVE", "ENDED"); }).not.toThrow();
    expect(() => { assertValidPlanTransition("ENDED", "ACTIVE"); }).not.toThrow();
  });

  it("permite manter o mesmo estado (idempotente)", () => {
    expect(() => { assertValidPlanTransition("ACTIVE", "ACTIVE"); }).not.toThrow();
  });
});
