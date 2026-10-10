// TC-MED-03 (test-cases.md): janela de toma — PENDING->UNCONFIRMED às 2h; confirmação tardia até ao
// fim do dia seguinte; correção até 7 dias; futuro >1h recusado.
import { describe, expect, it } from "vitest";
import {
  canActOnDose,
  canCorrectDose,
  confirmationDeadline,
  correctionDeadline,
  isPastUnconfirmedThreshold,
  isTooFarInFuture,
} from "./dose-occurrence.js";

const LISBON = "Europe/Lisbon";
const scheduledAt = new Date("2026-01-15T08:00:00.000Z");

describe("isPastUnconfirmedThreshold (Q2: 2h)", () => {
  it("falso antes de 2h", () => {
    expect(isPastUnconfirmedThreshold(scheduledAt, new Date("2026-01-15T09:59:59.999Z"))).toBe(false);
  });

  it("verdadeiro exatamente às 2h e depois", () => {
    expect(isPastUnconfirmedThreshold(scheduledAt, new Date("2026-01-15T10:00:00.000Z"))).toBe(true);
    expect(isPastUnconfirmedThreshold(scheduledAt, new Date("2026-01-16T10:00:00.000Z"))).toBe(true);
  });
});

describe("isTooFarInFuture (ST3: só até 1h antes)", () => {
  it("verdadeiro mais de 1h antes do horário", () => {
    expect(isTooFarInFuture(scheduledAt, new Date("2026-01-15T06:59:59.999Z"))).toBe(true);
  });

  it("falso a partir de 1h antes (inclusive) e depois do horário", () => {
    expect(isTooFarInFuture(scheduledAt, new Date("2026-01-15T07:00:00.000Z"))).toBe(false);
    expect(isTooFarInFuture(scheduledAt, new Date("2026-01-15T08:00:00.000Z"))).toBe(false);
    expect(isTooFarInFuture(scheduledAt, new Date("2026-02-01T00:00:00.000Z"))).toBe(false);
  });
});

describe("confirmationDeadline (Q2: até ao fim do dia seguinte, no fuso efetivo)", () => {
  it("fim do dia seguinte em Lisboa (inverno, UTC+0)", () => {
    // scheduledAt local = 2026-01-15 08:00 WET; dia seguinte = 2026-01-16; fim do dia = 23:59:59.999 WET.
    expect(confirmationDeadline(scheduledAt, LISBON).toISOString()).toBe("2026-01-16T23:59:59.999Z");
  });

  it("fim do dia seguinte em Lisboa no verão (UTC+1)", () => {
    const summerScheduledAt = new Date("2026-07-15T07:00:00.000Z"); // 08:00 WEST local.
    expect(confirmationDeadline(summerScheduledAt, LISBON).toISOString()).toBe("2026-07-16T22:59:59.999Z");
  });

  it("outro fuso (America/Sao_Paulo, UTC-3) calcula o dia seguinte local corretamente", () => {
    const localMidday = new Date("2026-01-15T15:00:00.000Z"); // 12:00 local em UTC-3.
    const deadline = confirmationDeadline(localMidday, "America/Sao_Paulo");
    // Fim de 2026-01-16 local (UTC-3) = 2026-01-17T02:59:59.999Z.
    expect(deadline.toISOString()).toBe("2026-01-17T02:59:59.999Z");
  });
});

describe("correctionDeadline (ST2: 7 dias)", () => {
  it("7 dias exatos a partir do horário previsto", () => {
    expect(correctionDeadline(scheduledAt).toISOString()).toBe("2026-01-22T08:00:00.000Z");
  });
});

describe("canActOnDose (AC-MED-02)", () => {
  it("recusa DOSE_IN_FUTURE mais de 1h antes do horário", () => {
    expect(canActOnDose(scheduledAt, new Date("2026-01-15T06:00:00.000Z"), LISBON)).toEqual({
      allowed: false,
      reason: "DOSE_IN_FUTURE",
    });
  });

  it("permite dentro de 1h antes do horário e até 2h depois (ainda PENDING)", () => {
    expect(canActOnDose(scheduledAt, new Date("2026-01-15T07:30:00.000Z"), LISBON)).toEqual({ allowed: true });
    expect(canActOnDose(scheduledAt, new Date("2026-01-15T09:30:00.000Z"), LISBON)).toEqual({ allowed: true });
  });

  it("permite confirmação tardia (UNCONFIRMED) até ao fim do dia seguinte", () => {
    expect(canActOnDose(scheduledAt, new Date("2026-01-16T23:59:59.999Z"), LISBON)).toEqual({ allowed: true });
  });

  it("recusa DOSE_WINDOW_EXPIRED depois do fim do dia seguinte", () => {
    expect(canActOnDose(scheduledAt, new Date("2026-01-17T00:00:00.001Z"), LISBON)).toEqual({
      allowed: false,
      reason: "DOSE_WINDOW_EXPIRED",
    });
  });
});

describe("canCorrectDose (ST2)", () => {
  it("permite dentro de 7 dias", () => {
    expect(canCorrectDose(scheduledAt, new Date("2026-01-22T08:00:00.000Z"))).toEqual({ allowed: true });
  });

  it("recusa DOSE_WINDOW_EXPIRED depois de 7 dias", () => {
    expect(canCorrectDose(scheduledAt, new Date("2026-01-22T08:00:00.001Z"))).toEqual({
      allowed: false,
      reason: "DOSE_WINDOW_EXPIRED",
    });
  });
});
