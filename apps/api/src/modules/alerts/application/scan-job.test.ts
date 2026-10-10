// AC-ALR-01..06 / TC-ALR-01..07: scanner idempotente, destinatários, tipos (R9/Q3), lembretes de
// agenda. Usa fakes em memória (fixtures.ts) com relógio controlado (FixedClock).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Appointment } from "../../appointments/index.js";
import type { Examination } from "../../examinations/index.js";
import type { DoseOccurrence } from "../../medications/index.js";
import { createAlertsFixtures, type AlertsFixtures } from "./fixtures.js";
import { createScanJobUseCase } from "./scan-job.js";

const NOW = new Date("2026-10-10T08:00:00Z");

function dose(overrides: Partial<DoseOccurrence> = {}): DoseOccurrence {
  return {
    id: "dose-1",
    familyId: "fam-1",
    memberId: "member-1",
    planId: "plan-1",
    medicationName: "x",
    dosage: "x",
    scheduledAt: NOW,
    status: "PENDING",
    generationVersion: 1,
    createdAt: NOW,
    ...overrides,
  };
}

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "apt-1",
    familyId: "fam-1",
    memberId: "member-1",
    scheduledAt: NOW,
    status: "SCHEDULED",
    createdAt: NOW,
    ...overrides,
  };
}

function examination(overrides: Partial<Examination> = {}): Examination {
  return {
    id: "exam-1",
    familyId: "fam-1",
    memberId: "member-1",
    name: "x",
    examDate: "2026-10-11",
    status: "SCHEDULED",
    createdAt: NOW,
    ...overrides,
  };
}

describe("alerts.scan", () => {
  let clock: FixedClock;
  let fx: AlertsFixtures;

  beforeEach(() => {
    clock = new FixedClock(NOW);
    fx = createAlertsFixtures(clock);
    fx.families.seedMember({ id: "member-1", familyId: "fam-1", userId: "user-1", name: "Titular", birthDate: "1990-01-01", isDependent: false, status: "ACTIVE", createdAt: NOW });
  });

  it("TC-ALR-01: gera dose.due no horário; não gera dose.repeat antes dos 15 min", async () => {
    fx.medications.doses = [dose({ scheduledAt: NOW })];
    const scan = createScanJobUseCase(fx.deps);
    const result = await scan();
    expect(result.alertsCreated).toBe(1);
    const alerts = [...fx.alertsRepo.byId.values()];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.ruleKey).toBe("dose.due");
    expect(fx.notifications.enqueued).toHaveLength(1);
  });

  it("TC-ALR-01: repete uma vez aos 15 min se ainda não confirmada", async () => {
    fx.medications.doses = [dose({ scheduledAt: NOW })];
    const scan = createScanJobUseCase(fx.deps);
    await scan();
    clock.advance(15 * 60_000);
    const result = await scan();
    expect(result.alertsCreated).toBe(1);
    const ruleKeys = [...fx.alertsRepo.byId.values()].map((a) => a.ruleKey).sort();
    expect(ruleKeys).toEqual(["dose.due", "dose.repeat"]);
  });

  it("TC-ALR-01: não repete se a toma já foi confirmada (sai de PENDING/UNCONFIRMED)", async () => {
    fx.medications.doses = [dose({ scheduledAt: NOW })];
    const scan = createScanJobUseCase(fx.deps);
    await scan();
    fx.medications.doses = []; // TAKEN: já não aparece como candidata
    clock.advance(15 * 60_000);
    const result = await scan();
    expect(result.alertsCreated).toBe(0);
  });

  it("TC-ALR-02: idempotência — correr o scan N vezes não duplica alertas", async () => {
    fx.medications.doses = [dose({ scheduledAt: NOW })];
    const scan = createScanJobUseCase(fx.deps);
    await scan();
    await scan();
    await scan();
    expect(fx.alertsRepo.byId.size).toBe(1);
    expect(fx.notifications.enqueued).toHaveLength(1);
  });

  it("TC-ALR-03: dependente sem conta só notifica os tutores", async () => {
    fx.families.members.set("member-1", {
      id: "member-1",
      familyId: "fam-1",
      name: "Dependente",
      birthDate: "2015-01-01",
      isDependent: true,
      status: "ACTIVE",
      createdAt: NOW,
    });
    fx.families.guardianUserIdsByDependent.set("member-1", ["tutor-1", "tutor-2"]);
    fx.medications.doses = [dose({ scheduledAt: NOW })];
    const scan = createScanJobUseCase(fx.deps);
    await scan();
    const recipients = [...fx.alertsRepo.byId.values()].map((a) => a.recipientUserId).sort();
    expect(recipients).toEqual(["tutor-1", "tutor-2"]);
  });

  it("TC-ALR-03: dependente com conta notifica o próprio e os tutores", async () => {
    fx.families.members.set("member-1", {
      id: "member-1",
      familyId: "fam-1",
      userId: "dep-user-1",
      name: "Dependente",
      birthDate: "2015-01-01",
      isDependent: true,
      status: "ACTIVE",
      createdAt: NOW,
    });
    fx.families.guardianUserIdsByDependent.set("member-1", ["tutor-1"]);
    fx.medications.doses = [dose({ scheduledAt: NOW })];
    const scan = createScanJobUseCase(fx.deps);
    await scan();
    const recipients = [...fx.alertsRepo.byId.values()].map((a) => a.recipientUserId).sort();
    expect(recipients).toEqual(["dep-user-1", "tutor-1"]);
  });

  it("Q3/UC-ALR-05: tipo desativado para um destinatário ⇒ nem o alerta é criado", async () => {
    fx.notifications.disableType("user-1", "MEDICATION_DUE");
    fx.medications.doses = [dose({ scheduledAt: NOW })];
    const scan = createScanJobUseCase(fx.deps);
    const result = await scan();
    expect(result.alertsCreated).toBe(0);
    expect(fx.notifications.enqueued).toHaveLength(0);
  });

  it("TC-ALR-07: lembretes de consulta 24h e 2h antes", async () => {
    fx.appointments.appointments = [appointment({ scheduledAt: new Date(NOW.getTime() + 2 * 60 * 60 * 1000) })];
    const scan = createScanJobUseCase(fx.deps);
    const result = await scan();
    const ruleKeys = [...fx.alertsRepo.byId.values()].map((a) => a.ruleKey).sort();
    // à chegada aos 2h antes, o lembrete das 24h já devia ter disparado num scan anterior —
    // num único scan em que ambos os limiares já passaram, os dois são gerados de uma vez.
    expect(ruleKeys).toEqual(["appointment.24h", "appointment.2h"]);
    expect(result.alertsCreated).toBe(2);
  });

  it("TC-ALR-07: pedido de confirmação do desfecho 24h depois de uma consulta passada; marca outcome_requested_at", async () => {
    fx.appointments.appointments = [appointment({ scheduledAt: new Date(NOW.getTime() - 25 * 60 * 60 * 1000) })];
    const scan = createScanJobUseCase(fx.deps);
    const result = await scan();
    expect(result.alertsCreated).toBe(1);
    const alert = [...fx.alertsRepo.byId.values()][0];
    expect(alert?.ruleKey).toBe("appointment.outcome");
    expect(alert?.type).toBe("APPOINTMENT_OUTCOME_REQUEST");
    expect(fx.appointments.outcomeRequestedAt.has("apt-1")).toBe(true);
  });

  it("TC-ALR-07: exame 24h antes (fuso efetivo do sujeito)", async () => {
    fx.families.timeZoneByMember.set("member-1", "UTC");
    fx.examinations.examinations = [examination({ examDate: "2026-10-11" })];
    const scan = createScanJobUseCase(fx.deps);
    const result = await scan();
    expect(result.alertsCreated).toBe(1);
    const alert = [...fx.alertsRepo.byId.values()][0];
    expect(alert?.ruleKey).toBe("exam.24h");
    // meia-noite local de 2026-10-11 (UTC) - 24h == 2026-10-10T00:00:00Z <= NOW (08:00) ⇒ já devido.
    expect(alert?.triggerAt.toISOString()).toBe("2026-10-10T00:00:00.000Z");
  });
});
