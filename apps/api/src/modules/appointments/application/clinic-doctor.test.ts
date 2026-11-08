// AC-CLN-28 / TC-AZ-CLN-V5 (aplicação): o Médico só vê e age em marcações cujo horário é do seu profissional (404 fora disso)
// e nunca recebe `receiptId`; Admin/Gestor veem tudo e recebem o `receiptId` do recibo ISSUED (BR-CLN-31/39).
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Appointment } from "../domain/appointment.js";
import { createListClinicAgendaUseCase, createCompleteClinicAppointmentUseCase } from "./clinic-appointments.js";
import { createClearClinicFollowUpUseCase, createSetClinicFollowUpUseCase, createStartClinicAppointmentUseCase } from "./clinic-day-flow.js";
import { createAppointmentsFixtures } from "./fixtures.js";
import type { ClinicPortalActor } from "./ports.js";

const NOW = new Date("2026-11-08T09:00:00Z");
const CLINIC = "clinic-a";
const CTX = { requestId: "req-1" };
const ADMIN: ClinicPortalActor = { clinicAccountId: "admin", clinicId: CLINIC };
const DOCTOR: ClinicPortalActor = { clinicAccountId: "doc", clinicId: CLINIC, professionalId: "prof-1" };
const OTHER_DOCTOR: ClinicPortalActor = { clinicAccountId: "doc2", clinicId: CLINIC, professionalId: "prof-2" };

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function setup() {
  const fx = createAppointmentsFixtures(new FixedClock(NOW));
  fx.clinics.seed(CLINIC, "Clínica Sol", "");
  const slot = (id: string, professionalId: string) => { fx.clinics.seedSlot({ id, clinicId: CLINIC, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: new Date(NOW.getTime() + 3_600_000), durationMinutes: 30, capacity: 1, professionalId, professionalName: professionalId }); };
  slot("slot-1", "prof-1");
  slot("slot-2", "prof-2");
  fx.memberNames.seed("fam", "mem", "Maria Silva");
  const seed = (id: string, slotId: string | undefined, status: Appointment["status"] = "SCHEDULED") => {
    const a: Appointment = { id, familyId: "fam", memberId: "mem", scheduledAt: new Date(NOW.getTime() + 3_600_000), status, confirmationStatus: "PENDING", clinicId: CLINIC, createdAt: NOW, ...(slotId ? { slotId } : {}) };
    fx.appointmentsRepo.seed(a);
  };
  seed("apt-1", "slot-1");
  seed("apt-2", "slot-2");
  seed("apt-noslot", undefined);
  seed("apt-done", "slot-1", "COMPLETED");
  return { fx, list: createListClinicAgendaUseCase(fx.deps) };
}

describe("agenda do Médico (BR-CLN-39)", () => {
  it("o Médico só vê as marcações do seu profissional; Admin vê tudo", async () => {
    const { list } = setup();
    expect((await list(DOCTOR, {})).map((v) => v.id).sort()).toEqual(["apt-1", "apt-done"]);
    expect((await list(OTHER_DOCTOR, {})).map((v) => v.id)).toEqual(["apt-2"]);
    expect((await list(ADMIN, {})).map((v) => v.id).sort()).toEqual(["apt-1", "apt-2", "apt-done", "apt-noslot"]);
  });

  it("start, follow-up e complete de marcação de outro profissional (ou sem horário) => 404; da sua => ok", async () => {
    const { fx } = setup();
    const start = createStartClinicAppointmentUseCase(fx.deps);
    const complete = createCompleteClinicAppointmentUseCase(fx.deps);
    expect(await codeOf(start(DOCTOR, "apt-2", CTX))).toBe("NOT_FOUND");
    expect(await codeOf(start(DOCTOR, "apt-noslot", CTX))).toBe("NOT_FOUND");
    expect(await codeOf(complete(DOCTOR, "apt-2", { outcomeNote: null }, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(createSetClinicFollowUpUseCase(fx.deps)(DOCTOR, "apt-done", { amount: 2, unit: "WEEKS" }, CTX))).not.toBe("NOT_FOUND");
    expect(await codeOf(createSetClinicFollowUpUseCase(fx.deps)(DOCTOR, "apt-2", { amount: 2, unit: "WEEKS" }, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(createClearClinicFollowUpUseCase(fx.deps)(DOCTOR, "apt-2", CTX))).toBe("NOT_FOUND");
    expect((await start(DOCTOR, "apt-1", CTX)).dayState).toBe("IN_PROGRESS");
    expect((await complete(DOCTOR, "apt-1", { outcomeNote: "ok" }, CTX)).status).toBe("COMPLETED");
  });
});

describe("receiptId nas marcações concluídas (BR-CLN-31/39)", () => {
  it("Admin/Gestor recebem o receiptId do recibo ISSUED; o Médico nunca", async () => {
    const { fx, list } = setup();
    fx.receipts.issued.set("apt-done", "receipt-1");
    const admin = await list(ADMIN, {});
    expect(admin.find((v) => v.id === "apt-done")?.receiptId).toBe("receipt-1");
    expect(admin.find((v) => v.id === "apt-1")?.receiptId).toBeUndefined();
    const doctor = await list(DOCTOR, {});
    expect(doctor.every((v) => v.receiptId === undefined)).toBe(true);
  });
});
