// TC-CLN-15 (visitas manuais): mesmas regras do fluxo do dia que as consultas Vita, mais as específicas da visita (BR-CLN-25/28/30).
import { describe, expect, it } from "vitest";
import { DomainError } from "../../../platform/errors/index.js";
import type { ClinicVisit } from "./clinic-visit.js";
import { computeVisitFollowUpDueOn, deriveVisitDayState, isFollowUpNotified, planVisitArrive, planVisitConfirmation, planVisitNoShow, planVisitStart, visitWaitingMinutes } from "./day-flow.js";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const visit = (overrides: Partial<ClinicVisit> = {}): Pick<ClinicVisit, "status" | "scheduledAt" | "confirmationStatus" | "arrivedAt" | "startedAt"> => ({
  status: "SCHEDULED",
  scheduledAt: new Date("2026-11-08T15:00:00.000Z"),
  confirmationStatus: "PENDING",
  ...overrides,
});

describe("visita: fluxo do dia", () => {
  it("dayState e espera derivados", () => {
    const a = new Date("2026-11-08T11:00:00.000Z");
    expect(deriveVisitDayState("SCHEDULED")).toBe("SCHEDULED");
    expect(deriveVisitDayState("SCHEDULED", a)).toBe("ARRIVED");
    expect(deriveVisitDayState("SCHEDULED", a, NOW)).toBe("IN_PROGRESS");
    expect(deriveVisitDayState("NO_SHOW")).toBe("NO_SHOW");
    expect(visitWaitingMinutes(a, undefined, NOW)).toBe(60);
    expect(visitWaitingMinutes(undefined, undefined, NOW)).toBeNull();
  });

  it("chegar: define uma só vez; NO_SHOW volta a SCHEDULED; fora do dia ou terminal => INVALID_STATE_TRANSITION", () => {
    expect(planVisitArrive(visit(), NOW)).toEqual({ status: "SCHEDULED", arrivedAt: NOW, changed: true });
    expect(planVisitArrive(visit({ arrivedAt: new Date("2026-11-08T08:00:00.000Z") }), NOW).changed).toBe(false);
    expect(planVisitArrive(visit({ status: "NO_SHOW" }), NOW)).toMatchObject({ status: "SCHEDULED", changed: true });
    expect(() => planVisitArrive(visit({ status: "COMPLETED" }), NOW)).toThrow(expect.objectContaining({ code: "INVALID_STATE_TRANSITION" }) as DomainError);
    expect(() => planVisitArrive(visit({ scheduledAt: new Date("2026-11-09T09:00:00.000Z") }), NOW)).toThrow(DomainError);
  });

  it("iniciar, faltar e confirmar", () => {
    expect(planVisitStart(visit(), NOW)).toEqual({ arrivedAt: NOW, startedAt: NOW, changed: true });
    expect(() => planVisitStart(visit({ status: "NO_SHOW" }), NOW)).toThrow(DomainError);
    const past = new Date("2026-11-08T11:00:00.000Z");
    expect(planVisitNoShow(visit({ scheduledAt: past }), NOW)).toBe(true);
    expect(planVisitNoShow(visit({ status: "NO_SHOW" }), NOW)).toBe(false);
    expect(() => planVisitNoShow(visit(), NOW)).toThrow(DomainError);
    expect(() => planVisitNoShow(visit({ scheduledAt: past, startedAt: past, arrivedAt: past }), NOW)).toThrow(DomainError);
    expect(planVisitConfirmation(visit(), NOW)).toBe(true);
    expect(planVisitConfirmation(visit({ confirmationStatus: "CONFIRMED" }), NOW)).toBe(false);
    expect(() => planVisitConfirmation(visit({ scheduledAt: past }), NOW)).toThrow(DomainError);
  });
});

describe("retorno e patientNotified", () => {
  it("calcula o dia local + N e só em COMPLETED", () => {
    expect(computeVisitFollowUpDueOn({ status: "COMPLETED", scheduledAt: new Date("2026-08-31T10:00:00.000Z") }, 6, "MONTHS")).toBe("2027-02-28");
    expect(() => computeVisitFollowUpDueOn({ status: "SCHEDULED", scheduledAt: NOW }, 1, "WEEKS")).toThrow(DomainError);
    expect(() => computeVisitFollowUpDueOn({ status: "COMPLETED", scheduledAt: NOW }, 25, "WEEKS")).toThrow(expect.objectContaining({ code: "VALIDATION_ERROR" }) as DomainError);
  });

  it("patientNotified: só Vita e hoje >= dueOn - 7 dias", () => {
    expect(isFollowUpNotified("VITA", "2026-11-15", NOW)).toBe(true);
    expect(isFollowUpNotified("VITA", "2026-11-16", NOW)).toBe(false);
    expect(isFollowUpNotified("VITA", "2026-11-01", NOW)).toBe(true);
    expect(isFollowUpNotified("MANUAL", "2026-11-09", NOW)).toBe(false);
  });
});
