// AC-CLN-28 / TC-AZ-CLN-V5 (aplicação): âmbito do Médico em pacientes, ficha, calendário, retornos e visitas (BR-CLN-39);
// Admin/Gestor sem filtro; o Médico nunca recebe `receiptId`.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { ClinicVisit } from "../domain/clinic-visit.js";
import { createGetClinicCalendarUseCase } from "./calendar.js";
import { createClinicPatientsFixtures } from "./fixtures.js";
import { createGetClinicPatientUseCase, createListClinicPatientsUseCase } from "./patients.js";
import { createGetClinicPatientRecordUseCase } from "./record.js";
import { createListClinicFollowUpsUseCase } from "./reports.js";
import { createGetSharedHistoryUseCase } from "./shared-history.js";
import { createSetVisitFollowUpUseCase, createStartVisitUseCase } from "./visit-day-flow.js";
import { createCompleteVisitUseCase, createListVisitsUseCase } from "./visits.js";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const CLINIC = "clinic-a";
const ADMIN = { clinicAccountId: "admin", clinicId: CLINIC };
const DOCTOR = { clinicAccountId: "doc", clinicId: CLINIC, professionalId: "prof-1" };
const CTX = { requestId: "req-1" };

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function setup() {
  const fx = createClinicPatientsFixtures(new FixedClock(NOW));
  const d = fx.deps;
  const slot = (id: string, professionalId: string) => { fx.slots.seed({ id, clinicId: CLINIC, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: new Date("2026-11-08T15:00:00.000Z"), durationMinutes: 30, capacity: 1, professionalId, professionalName: professionalId }); };
  slot("slot-1", "prof-1");
  slot("slot-2", "prof-2");
  fx.slots.professionals.set("prof-1", { id: "prof-1", clinicId: CLINIC, name: "Dra. Lima" });
  const patient = (id: string, name: string) => fx.patientsRepo.byId.set(id, { id, clinicId: CLINIC, name, origin: "MANUAL", createdAt: NOW, updatedAt: NOW });
  patient("cp-mine", "Ana Minha");
  patient("cp-other", "Bruno Outro");
  patient("cp-none", "Carla Sem Marcação");
  const visit = (id: string, clinicPatientId: string, slotId: string | undefined, status: ClinicVisit["status"] = "SCHEDULED", extra: Partial<ClinicVisit> = {}) =>
    fx.visitsRepo.byId.set(id, { id, clinicId: CLINIC, clinicPatientId, scheduledAt: new Date("2026-11-08T15:00:00.000Z"), durationMinutes: 30, status, confirmationStatus: "PENDING", createdAt: NOW, ...(slotId ? { slotId } : {}), ...extra });
  visit("v-mine", "cp-mine", "slot-1");
  visit("v-other", "cp-other", "slot-2");
  visit("v-done", "cp-mine", "slot-1", "COMPLETED", { followUpDueOn: "2026-11-20" });
  visit("v-done-other", "cp-other", "slot-2", "COMPLETED", { followUpDueOn: "2026-11-21" });
  return { fx, d };
}

describe("pacientes do Médico", () => {
  it("lista só os pacientes com marcação no seu profissional; Admin vê todos", async () => {
    const { d } = setup();
    const list = createListClinicPatientsUseCase(d);
    expect((await list(DOCTOR, {})).items.map((p) => p.id)).toEqual(["cp-mine"]);
    expect((await list(ADMIN, {})).items.map((p) => p.id).sort()).toEqual(["cp-mine", "cp-none", "cp-other"]);
  });

  it("ficha, detalhe e histórico partilhado de paciente fora do âmbito => 404; no âmbito => ok", async () => {
    const { d } = setup();
    const get = createGetClinicPatientUseCase(d);
    const record = createGetClinicPatientRecordUseCase(d);
    const shared = createGetSharedHistoryUseCase(d);
    expect((await get(DOCTOR, "cp-mine")).id).toBe("cp-mine");
    for (const id of ["cp-other", "cp-none", "inexistente"]) {
      expect(await codeOf(get(DOCTOR, id))).toBe("NOT_FOUND");
      expect(await codeOf(record(DOCTOR, id))).toBe("NOT_FOUND");
      expect(await codeOf(shared(DOCTOR, id, CTX))).toBe("NOT_FOUND");
    }
    expect((await shared(DOCTOR, "cp-mine", CTX)).active).toBe(false);
  });

  it("a ficha do Médico fica limitada às suas marcações", async () => {
    const { fx, d } = setup();
    fx.visitsRepo.byId.set("v-mine-other-prof", { id: "v-mine-other-prof", clinicId: CLINIC, clinicPatientId: "cp-mine", slotId: "slot-2", scheduledAt: NOW, durationMinutes: 30, status: "SCHEDULED", confirmationStatus: "PENDING", createdAt: NOW });
    const record = createGetClinicPatientRecordUseCase(d);
    expect((await record(DOCTOR, "cp-mine")).bookings.map((b) => b.id).sort()).toEqual(["v-done", "v-mine"]);
    expect((await record(ADMIN, "cp-mine")).bookings.map((b) => b.id).sort()).toEqual(["v-done", "v-mine", "v-mine-other-prof"]);
  });
});

describe("visitas, calendário e retornos do Médico", () => {
  it("lista de visitas filtrada; start/complete/follow-up de visita alheia => null (404 no despacho)", async () => {
    const { d } = setup();
    expect((await createListVisitsUseCase(d)(undefined as never, CLINIC, { professionalId: "prof-1" })).map((v) => v.id).sort()).toEqual(["v-done", "v-mine"]);
    expect(await createStartVisitUseCase(d)(undefined as never, DOCTOR, "v-other", CTX)).toBeNull();
    expect(await createCompleteVisitUseCase(d)(undefined as never, DOCTOR, "v-other", {}, CTX)).toBeNull();
    expect(await createSetVisitFollowUpUseCase(d)(undefined as never, DOCTOR, "v-done-other", { amount: 1, unit: "WEEKS" }, CTX)).toBeNull();
    expect((await createStartVisitUseCase(d)(undefined as never, DOCTOR, "v-mine", CTX))?.dayState).toBe("IN_PROGRESS");
  });

  it("calendário: só a sua coluna; professionalId de outro => 404", async () => {
    const { d } = setup();
    const calendar = createGetClinicCalendarUseCase(d);
    const window = { from: "2026-11-08", to: "2026-11-09" };
    expect(await codeOf(calendar(DOCTOR, { ...window, professionalId: "prof-2" }))).toBe("NOT_FOUND");
    const view = await calendar(DOCTOR, window);
    expect(view.entries.every((e) => e.professionalId === "prof-1")).toBe(true);
    expect(view.entries.length).toBeGreaterThan(0);
  });

  it("retornos a contactar: só os das suas visitas", async () => {
    const { d } = setup();
    const followUps = createListClinicFollowUpsUseCase(d);
    expect((await followUps(DOCTOR, "2026-12-31")).map((f) => f.bookingId)).toEqual(["v-done"]);
    expect((await followUps(ADMIN, "2026-12-31")).map((f) => f.bookingId).sort()).toEqual(["v-done", "v-done-other"]);
  });

  it("receiptId nas visitas concluídas: Admin recebe; o Médico não", async () => {
    const { fx, d } = setup();
    fx.receipts.issued.set("v-done", "receipt-1");
    // `complete` devolve a vista com receiptId só via o despacho de `appointments`; aqui a vista de follow-up (que passa por attach).
    const setFollowUp = createSetVisitFollowUpUseCase(d);
    expect((await setFollowUp(undefined as never, ADMIN, "v-done", { amount: 1, unit: "WEEKS" }, CTX))?.receiptId).toBe("receipt-1");
    expect((await setFollowUp(undefined as never, DOCTOR, "v-done", { amount: 1, unit: "WEEKS" }, CTX))?.receiptId).toBeUndefined();
  });
});
