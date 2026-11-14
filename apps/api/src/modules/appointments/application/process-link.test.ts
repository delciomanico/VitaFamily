// Marco B fatia 1 (BR-PRC-01/07, TC-PRC-10/13/12): as consultas abrem e apagam o seu Process pela porta ProcessLinker,
// nos dois caminhos de criação da família e na marcação presencial D20 (fakes em memória, sem I/O).
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { toAppointmentResponse, toClinicAppointmentResponse } from "../interface/dto.js";
import { createCreateWalkInAppointmentUseCase } from "./clinic-walk-in.js";
import { createCreateAppointmentUseCase } from "./create-appointment.js";
import { createDeleteAppointmentUseCase } from "./delete-appointment.js";
import { createAppointmentsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const SLOT_AT = new Date("2026-02-01T09:00:00.000Z");
const CTX = { requestId: "req-1", ip: "10.0.0.1" };
const ACTOR = { userId: "u1", platformAdmin: false };
const FAMILY = "f1";
const MEMBER = "m1";

function setup() {
  const fx = createAppointmentsFixtures(new FixedClock(NOW));
  fx.clinics.seed("clinic-1", "Clínica Sol", FAMILY);
  fx.clinics.seedSlot({ id: "slot-1", clinicId: "clinic-1", kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: SLOT_AT, durationMinutes: 30, capacity: 1 });
  return fx;
}

describe("abertura do Process ao criar a consulta (TC-PRC-10, BR-PRC-01)", () => {
  it("consulta livre da família: abre 1 processo com o id do ato, grava o processId e devolve-o na resposta", async () => {
    const fx = setup();
    const appointment = await createCreateAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);
    expect(fx.processes.opened).toEqual([expect.objectContaining({ familyId: FAMILY, memberId: MEMBER, originId: appointment.id, by: expect.objectContaining({ actorType: "USER", actorUserId: "u1", requestId: "req-1", ip: "10.0.0.1" }) as unknown })]);
    expect(fx.processes.opened[0]?.clinicId).toBeUndefined();
    expect(appointment.processId).toBe(fx.processes.opened[0]?.processId);
    expect(toAppointmentResponse(appointment).processId).toBe(appointment.processId);
  });

  it("pedido num horário de clínica: o processo leva o clinicId", async () => {
    const fx = setup();
    const appointment = await createCreateAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, { scheduledAt: "x", clinicId: "clinic-1", slotId: "slot-1" }, CTX);
    expect(appointment.status).toBe("REQUESTED");
    expect(fx.processes.opened[0]).toMatchObject({ originId: appointment.id, clinicId: "clinic-1" });
  });

  it("marcação presencial D20: ator CLINIC_ACCOUNT, clinicId e processId também na vista da clínica (ClinicBooking)", async () => {
    const fx = setup();
    fx.patients.seed("maria@example.pt", FAMILY, MEMBER, "Maria Silva");
    fx.memberNames.seed(FAMILY, MEMBER, "Maria Silva");
    const view = await createCreateWalkInAppointmentUseCase(fx.deps)({ clinicAccountId: "acc-1", clinicId: "clinic-1" }, { patientEmail: "maria@example.pt", slotId: "slot-1" }, CTX);
    expect(fx.processes.opened).toEqual([expect.objectContaining({ originId: view.id, clinicId: "clinic-1", by: expect.objectContaining({ actorType: "CLINIC_ACCOUNT", actorClinicAccountId: "acc-1" }) as unknown })]);
    expect(view.processId).toBe(fx.processes.opened[0]?.processId);
    expect(toClinicAppointmentResponse(view).processId).toBe(view.processId);
  });

  it("falha ao abrir o processo => o ato não existe (a transação reverte)", async () => {
    const fx = setup();
    fx.processes.failOpen = new Error("boom");
    await expect(createCreateAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX)).rejects.toThrow("boom");
    expect(fx.appointmentsRepo.byId.size).toBe(0);
    expect(fx.audit.events).toHaveLength(0);
  });

  it("TC-PRC-12: visita manual da clínica (paciente sem ligação Vita, BR-CLN-24) NÃO abre Process", async () => {
    const fx = setup();
    fx.clinicPatients.patients.set("cp-1", { clinicId: "clinic-1", name: "Paciente Manual", link: null });
    const view = await createCreateWalkInAppointmentUseCase(fx.deps)({ clinicAccountId: "acc-1", clinicId: "clinic-1" }, { clinicPatientId: "cp-1", slotId: "slot-1" }, CTX);
    expect(view.source).toBe("MANUAL");
    expect(fx.processes.opened).toEqual([]);
    expect(fx.appointmentsRepo.byId.size).toBe(0);
  });

  it("ClinicBooking de visita manual (sem ids Vita) leva processId null (BR-CLN-24)", () => {
    expect(toClinicAppointmentResponse({ id: "v1", status: "SCHEDULED", scheduledAt: NOW.toISOString(), patientName: "X", confirmationStatus: "PENDING", dayState: "SCHEDULED", source: "MANUAL" }).processId).toBeNull();
  });
});

describe("apagar a consulta apaga o Process (TC-PRC-13, BR-PRC-07)", () => {
  it("chama discard com o id do ato e o ator", async () => {
    const fx = setup();
    const appointment = await createCreateAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);
    await createDeleteAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, appointment.id, CTX);
    expect(fx.processes.discarded).toEqual([{ originId: appointment.id, by: expect.objectContaining({ actorType: "USER", actorUserId: "u1" }) as unknown }]);
  });

  it("consulta inexistente => NOT_FOUND e nada é apagado", async () => {
    const fx = setup();
    await expect(createDeleteAppointmentUseCase(fx.deps)(ACTOR, FAMILY, MEMBER, "nope", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fx.processes.discarded).toEqual([]);
  });
});
