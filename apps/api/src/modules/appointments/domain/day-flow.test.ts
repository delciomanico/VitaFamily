// TC-CLN-13/15/16 (parte pura): estados de dia derivados, espera, chegada/início/falta, confirmação por telefone e cálculo do
// retorno (BR-CLN-25..30). Relógio sempre injetado como argumento.
import { describe, expect, it } from "vitest";
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import type { AppointmentStatus, ConfirmationStatus } from "./appointment.js";
import { computeFollowUpDueOn, deriveDayState, planArrive, planNoShow, planPhoneConfirmation, planStart, waitingMinutes, type DayFlowTarget } from "./day-flow.js";

// 2026-11-08 12:00 em Lisboa (WET, UTC+0).
const NOW = new Date("2026-11-08T12:00:00.000Z");
const target = (overrides: Partial<DayFlowTarget> = {}): DayFlowTarget => ({ status: "SCHEDULED", scheduledAt: new Date("2026-11-08T15:00:00.000Z"), confirmationStatus: "PENDING", ...overrides });

describe("deriveDayState (BR-CLN-28)", () => {
  const arrived = new Date("2026-11-08T11:00:00.000Z");
  const started = new Date("2026-11-08T11:30:00.000Z");
  it.each<[AppointmentStatus, Date | undefined, Date | undefined, string]>([
    ["SCHEDULED", undefined, undefined, "SCHEDULED"],
    ["SCHEDULED", arrived, undefined, "ARRIVED"],
    ["SCHEDULED", arrived, started, "IN_PROGRESS"],
    ["COMPLETED", arrived, started, "COMPLETED"],
    ["NO_SHOW", undefined, undefined, "NO_SHOW"],
    ["CANCELLED", arrived, undefined, "CANCELLED"],
    ["REQUESTED", undefined, undefined, "REQUESTED"],
    ["REJECTED", undefined, undefined, "REJECTED"],
  ])("%s com chegada=%s início=%s => %s", (status, arrivedAt, startedAt, expected) => {
    expect(deriveDayState(status, arrivedAt, startedAt)).toBe(expected);
  });
});

describe("waitingMinutes", () => {
  it("nulo sem chegada; minutos inteiros até ao início ou até agora; nunca negativo", () => {
    expect(waitingMinutes(undefined, undefined, NOW)).toBeNull();
    expect(waitingMinutes(new Date("2026-11-08T11:00:30.000Z"), undefined, NOW)).toBe(59);
    expect(waitingMinutes(new Date("2026-11-08T11:00:00.000Z"), new Date("2026-11-08T11:20:59.000Z"), NOW)).toBe(20);
    expect(waitingMinutes(new Date("2026-11-08T12:30:00.000Z"), undefined, NOW)).toBe(0);
  });
});

describe("planArrive (Chegou)", () => {
  it("define arrivedAt uma só vez; repetir não o altera (changed=false)", () => {
    const first = planArrive(target(), NOW);
    expect(first).toEqual({ status: "SCHEDULED", arrivedAt: NOW, changed: true });
    const again = planArrive(target({ arrivedAt: new Date("2026-11-08T08:00:00.000Z") }), NOW);
    expect(again.arrivedAt.toISOString()).toBe("2026-11-08T08:00:00.000Z");
    expect(again.changed).toBe(false);
  });

  it("a partir de NO_SHOW volta a SCHEDULED (chegada tardia)", () => {
    expect(planArrive(target({ status: "NO_SHOW" }), NOW)).toMatchObject({ status: "SCHEDULED", changed: true });
  });

  it.each<AppointmentStatus>(["COMPLETED", "CANCELLED", "REQUESTED", "REJECTED"])("estado %s => INVALID_STATE_TRANSITION", (status) => {
    expect(() => planArrive(target({ status }), NOW)).toThrow(expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }) as DomainError);
  });

  it("fora do dia local => INVALID_STATE_TRANSITION; virada de dia em Lisboa respeitada (verão UTC+1)", () => {
    expect(() => planArrive(target({ scheduledAt: new Date("2026-11-09T09:00:00.000Z") }), NOW)).toThrow(DomainError);
    // 23:30Z de 14/07 já é 15/07 em Lisboa (UTC+1): a consulta das 00:30 locais de dia 15 é "hoje" às 00:10 locais.
    const scheduledAt = new Date("2026-07-14T23:30:00.000Z");
    expect(planArrive(target({ scheduledAt }), new Date("2026-07-14T23:10:00.000Z")).changed).toBe(true);
    expect(() => planArrive(target({ scheduledAt }), new Date("2026-07-14T22:50:00.000Z"))).toThrow(DomainError);
  });
});

describe("planStart (Iniciar)", () => {
  it("sem Chegou regista as duas; com Chegou mantém arrivedAt; repetir mantém startedAt", () => {
    expect(planStart(target(), NOW)).toEqual({ arrivedAt: NOW, startedAt: NOW, changed: true });
    const arrivedAt = new Date("2026-11-08T11:00:00.000Z");
    expect(planStart(target({ arrivedAt }), NOW)).toEqual({ arrivedAt, startedAt: NOW, changed: true });
    const startedAt = new Date("2026-11-08T11:30:00.000Z");
    expect(planStart(target({ arrivedAt, startedAt }), NOW)).toEqual({ arrivedAt, startedAt, changed: false });
  });

  it("só SCHEDULED e no dia local", () => {
    expect(() => planStart(target({ status: "NO_SHOW" }), NOW)).toThrow(DomainError);
    expect(() => planStart(target({ status: "COMPLETED" }), NOW)).toThrow(DomainError);
    expect(() => planStart(target({ scheduledAt: new Date("2026-11-07T15:00:00.000Z") }), NOW)).toThrow(DomainError);
  });
});

describe("planNoShow (Faltou)", () => {
  it("SCHEDULED, hora passada e sem início => true; já NO_SHOW => false (idempotente)", () => {
    expect(planNoShow(target({ scheduledAt: new Date("2026-11-08T11:00:00.000Z") }), NOW)).toBe(true);
    expect(planNoShow(target({ status: "NO_SHOW" }), NOW)).toBe(false);
  });

  it("antes da hora, após iniciar ou em CANCELLED/COMPLETED => INVALID_STATE_TRANSITION", () => {
    const past = new Date("2026-11-08T11:00:00.000Z");
    expect(() => planNoShow(target(), NOW)).toThrow(DomainError);
    expect(() => planNoShow(target({ scheduledAt: past, arrivedAt: past, startedAt: past }), NOW)).toThrow(DomainError);
    expect(() => planNoShow(target({ scheduledAt: past, status: "CANCELLED" }), NOW)).toThrow(DomainError);
    expect(() => planNoShow(target({ scheduledAt: past, status: "COMPLETED" }), NOW)).toThrow(DomainError);
  });
});

describe("planPhoneConfirmation", () => {
  it.each<[ConfirmationStatus, boolean]>([
    ["PENDING", true],
    ["CONFIRMED", false],
  ])("%s => muda=%s", (confirmationStatus, changes) => {
    expect(planPhoneConfirmation(target({ confirmationStatus }), NOW)).toBe(changes);
  });

  it("não SCHEDULED ou já passada => INVALID_STATE_TRANSITION", () => {
    expect(() => planPhoneConfirmation(target({ status: "CANCELLED", confirmationStatus: "DECLINED" }), NOW)).toThrow(DomainError);
    expect(() => planPhoneConfirmation(target({ scheduledAt: new Date("2026-11-08T11:59:00.000Z") }), NOW)).toThrow(DomainError);
  });
});

describe("computeFollowUpDueOn (BR-CLN-30)", () => {
  const done = (iso: string) => ({ status: "COMPLETED" as const, scheduledAt: new Date(iso) });
  it.each([
    ["2026-11-08T10:00:00.000Z", 2, "WEEKS", "2026-11-22"],
    ["2026-11-08T10:00:00.000Z", 1, "MONTHS", "2026-12-08"],
    ["2026-01-31T10:00:00.000Z", 1, "MONTHS", "2026-02-28"],
    ["2028-01-31T10:00:00.000Z", 1, "MONTHS", "2028-02-29"],
    ["2026-08-31T10:00:00.000Z", 6, "MONTHS", "2027-02-28"],
    ["2026-05-31T10:00:00.000Z", 24, "MONTHS", "2028-05-31"],
    // dia local, não UTC: 23:30Z de 14/07 é 15/07 em Lisboa
    ["2026-07-14T23:30:00.000Z", 1, "WEEKS", "2026-07-22"],
  ])("%s + %i %s => %s", (scheduledAt, amount, unit, expected) => {
    expect(computeFollowUpDueOn(done(scheduledAt), amount, unit)).toBe(expected);
  });

  it.each([0, 25, 1.5, "3", null, undefined])("quantidade %s => VALIDATION_ERROR", (amount) => {
    expect(() => computeFollowUpDueOn(done("2026-11-08T10:00:00.000Z"), amount, "WEEKS")).toThrow(ValidationError);
  });

  it("unidade inválida => VALIDATION_ERROR; marcação não COMPLETED => INVALID_STATE_TRANSITION", () => {
    expect(() => computeFollowUpDueOn(done("2026-11-08T10:00:00.000Z"), 2, "DAYS")).toThrow(ValidationError);
    expect(() => computeFollowUpDueOn({ status: "SCHEDULED", scheduledAt: NOW }, 2, "WEEKS")).toThrow(expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }) as DomainError);
  });
});
