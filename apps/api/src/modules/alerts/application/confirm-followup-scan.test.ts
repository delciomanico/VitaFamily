// TC-CLN-14 (AC-CLN-21): `appointment.confirm48h` e `followup.due` no scanner idempotente existente (relógio injetável).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Appointment } from "../../appointments/index.js";
import { listAlertsForTest } from "./list-alerts-helper.js";
import { createAlertsFixtures, type AlertsFixtures } from "./fixtures.js";
import { createScanJobUseCase } from "./scan-job.js";

const HOUR = 3_600_000;
// 2026-11-08 12:00 em Lisboa (WET).
const NOW = new Date("2026-11-08T12:00:00.000Z");

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return { id: "apt-1", familyId: "fam-1", memberId: "member-1", scheduledAt: new Date(NOW.getTime() + 48 * HOUR + 5 * 60_000), status: "SCHEDULED", confirmationStatus: "PENDING", slotId: "slot-1", clinicId: "clinic-1", createdAt: NOW, ...overrides };
}

describe("alerts.scan: pedido de confirmação a 48 h (BR-ALR-09)", () => {
  let clock: FixedClock;
  let fx: AlertsFixtures;

  beforeEach(() => {
    clock = new FixedClock(NOW);
    fx = createAlertsFixtures(clock);
    fx.families.seedMember({ id: "member-1", familyId: "fam-1", userId: "user-1", name: "Titular", birthDate: "1990-01-01", isDependent: false, status: "ACTIVE", createdAt: NOW });
  });
  const ruleKeys = () => [...fx.alertsRepo.byId.values()].map((a) => a.ruleKey).sort();

  it("emite um só APPOINTMENT_CONFIRM_REQUEST quando passam os 48 h; correr de novo não duplica", async () => {
    fx.appointments.appointments = [appointment()];
    const scan = createScanJobUseCase(fx.deps);
    expect((await scan()).alertsCreated).toBe(0); // faltam 5 min para os 48 h
    clock.advance(5 * 60_000);
    expect((await scan()).alertsCreated).toBe(1);
    await scan();
    clock.advance(60_000);
    await scan();
    const alerts = [...fx.alertsRepo.byId.values()];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "APPOINTMENT_CONFIRM_REQUEST", ruleKey: "appointment.confirm48h", sourceType: "APPOINTMENT", sourceId: "apt-1", recipientUserId: "user-1" });
    expect(alerts[0]?.triggerAt.toISOString()).toBe("2026-11-08T12:05:00.000Z");
    expect(fx.notifications.enqueued).toHaveLength(1);
  });

  it("às 24 h só o lembrete existente (appointment.24h), sem um 2.º pedido de confirmação; às 2 h idem", async () => {
    fx.appointments.appointments = [appointment()];
    const scan = createScanJobUseCase(fx.deps);
    clock.advance(5 * 60_000);
    await scan();
    clock.advance(24 * HOUR);
    await scan();
    clock.advance(22 * HOUR);
    await scan();
    expect(ruleKeys()).toEqual(["appointment.24h", "appointment.2h", "appointment.confirm48h"]);
  });

  it.each<[string, Partial<Appointment>]>([
    ["já CONFIRMED", { confirmationStatus: "CONFIRMED" }],
    ["DECLINED/CANCELLED", { status: "CANCELLED", confirmationStatus: "DECLINED" }],
    ["clínica privada (sem slotId)", { slotId: undefined as unknown as string }],
    ["marcada com menos de 48 h (os 48 h já passaram há muito)", { scheduledAt: new Date(NOW.getTime() + 30 * HOUR) }],
  ])("%s => nenhum pedido", async (_name, overrides) => {
    const base = appointment();
    const candidate = { ...base, ...overrides };
    if (overrides.slotId === (undefined as unknown as string) && "slotId" in overrides) delete candidate.slotId;
    fx.appointments.appointments = [candidate];
    const scan = createScanJobUseCase(fx.deps);
    clock.advance(10 * 60_000);
    await scan();
    expect(ruleKeys().filter((k) => k === "appointment.confirm48h")).toEqual([]);
  });

  it("confirmado por telefone antes dos 48 h => o pedido deixa de ser emitido", async () => {
    fx.appointments.appointments = [appointment()];
    const scan = createScanJobUseCase(fx.deps);
    await scan();
    fx.appointments.appointments = [appointment({ confirmationStatus: "CONFIRMED", confirmationSource: "CLINIC", confirmedAt: NOW })];
    clock.advance(5 * 60_000);
    await scan();
    expect(fx.alertsRepo.byId.size).toBe(0);
  });

  it("editar a hora recalcula: a dedupeKey inclui triggerAt (novo pedido para a nova hora)", async () => {
    fx.appointments.appointments = [appointment()];
    const scan = createScanJobUseCase(fx.deps);
    clock.advance(5 * 60_000);
    await scan();
    fx.appointments.appointments = [appointment({ scheduledAt: new Date(NOW.getTime() + 48 * HOUR + 65 * 60_000) })];
    clock.advance(60 * 60_000);
    await scan();
    expect([...fx.alertsRepo.byId.values()].filter((a) => a.ruleKey === "appointment.confirm48h")).toHaveLength(2);
  });

  it("dependente: tutores e o próprio (FR-ALR-08); preferência appointmentReminder desligada => sem alerta", async () => {
    fx.families.members.set("member-1", { id: "member-1", familyId: "fam-1", userId: "dep-user", name: "Dep", birthDate: "2015-01-01", isDependent: true, status: "ACTIVE", createdAt: NOW });
    fx.families.guardianUserIdsByDependent.set("member-1", ["tutor-1", "tutor-2"]);
    fx.notifications.disableType("tutor-2", "APPOINTMENT_CONFIRM_REQUEST");
    fx.appointments.appointments = [appointment()];
    clock.advance(5 * 60_000);
    await createScanJobUseCase(fx.deps)();
    expect([...fx.alertsRepo.byId.values()].map((a) => a.recipientUserId).sort()).toEqual(["dep-user", "tutor-1"]);
  });

  it("texto na app é genérico: sem nome do membro nem hora (canário)", async () => {
    fx.appointments.appointments = [appointment()];
    clock.advance(5 * 60_000);
    await createScanJobUseCase(fx.deps)();
    const [view] = await listAlertsForTest(fx, "user-1");
    expect(view?.message).toBe("Tem uma consulta para confirmar. Abra a app.");
    expect(view?.message).not.toMatch(/Titular|\d{2}:\d{2}|clinic/i);
  });
});

describe("alerts.scan: lembrete de retorno 7 dias antes (BR-CLN-30)", () => {
  let clock: FixedClock;
  let fx: AlertsFixtures;

  beforeEach(() => {
    clock = new FixedClock(NOW);
    fx = createAlertsFixtures(clock);
    fx.families.seedMember({ id: "member-1", familyId: "fam-1", userId: "user-1", name: "Titular", birthDate: "1990-01-01", isDependent: false, status: "ACTIVE", createdAt: NOW });
  });
  const done = (overrides: Partial<Appointment> = {}) => appointment({ status: "COMPLETED", scheduledAt: new Date("2026-10-20T10:00:00.000Z"), followUpDueOn: "2026-11-20", ...overrides });

  it("emite FOLLOWUP_REMINDER à meia-noite local de dueOn-7, uma só vez; antes disso nada", async () => {
    fx.appointments.appointments = [done()]; // 2026-11-20 -> lembrete a 2026-11-13T00:00 (WET)
    const scan = createScanJobUseCase(fx.deps);
    expect((await scan()).alertsCreated).toBe(0);
    clock.advance(36 * HOUR); // 2026-11-10
    expect((await scan()).alertsCreated).toBe(0);
    clock.advance(3 * 24 * HOUR); // 2026-11-13 12:00
    expect((await scan()).alertsCreated).toBe(1);
    await scan();
    clock.advance(24 * HOUR);
    await scan();
    const alerts = [...fx.alertsRepo.byId.values()];
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ type: "FOLLOWUP_REMINDER", ruleKey: "followup.due", sourceType: "APPOINTMENT", sourceId: "apt-1" });
    expect(alerts[0]?.triggerAt.toISOString()).toBe("2026-11-13T00:00:00.000Z");
    const [view] = await listAlertsForTest(fx, "user-1");
    expect(view?.message).toBe("Tem um retorno sugerido por uma clínica. Abra a app.");
  });

  it("data já a menos de 7 dias => no próximo ciclo; retorno limpo => nenhum; data passada => nenhum", async () => {
    const scan = createScanJobUseCase(fx.deps);
    fx.appointments.appointments = [done({ followUpDueOn: "2026-11-12" })];
    expect((await scan()).alertsCreated).toBe(1);

    fx.alertsRepo.byId.clear();
    fx.alertsRepo.byDedupeKey.clear();
    const cleared = done();
    delete cleared.followUpDueOn;
    fx.appointments.appointments = [cleared];
    expect((await scan()).alertsCreated).toBe(0);
    fx.appointments.appointments = [done({ followUpDueOn: "2026-11-01" })];
    expect((await scan()).alertsCreated).toBe(0);
  });

  it("preferência appointmentReminder desligada => o alerta não existe", async () => {
    fx.notifications.disableType("user-1", "FOLLOWUP_REMINDER");
    fx.appointments.appointments = [done({ followUpDueOn: "2026-11-12" })];
    expect((await createScanJobUseCase(fx.deps)()).alertsCreated).toBe(0);
  });
});
