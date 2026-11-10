// AC-CLN-34/35 / TC-CLN-25/26 (aplicação, M15 U, BR-CLN-51/53): `examOrders` em `complete` chama a porta na MESMA transação (Admin/Gestor
// => FORBIDDEN e nada muda), `examOrderCount` na agenda (consulta e visita) e em `Appointment` só para SELF/TUTOR_OF.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ForbiddenError } from "../../../platform/errors/index.js";
import type { Appointment } from "../domain/appointment.js";
import { createCompleteClinicAppointmentUseCase, createListClinicAgendaUseCase } from "./clinic-appointments.js";
import { createAppointmentsFixtures } from "./fixtures.js";
import { createGetAppointmentUseCase } from "./get-appointment.js";
import { createListAppointmentsUseCase } from "./list-appointments.js";
import type { ClinicPortalActor } from "./ports.js";

const NOW = new Date("2026-11-10T09:00:00Z");
const CLINIC = "clinic-a";
const CTX = { requestId: "req-1" };
const ADMIN: ClinicPortalActor = { clinicAccountId: "admin", clinicId: CLINIC };
const DOCTOR: ClinicPortalActor = { clinicAccountId: "doc", clinicId: CLINIC, professionalId: "prof-1" };
const ORDERS = [{ name: "Hemograma" }, { name: "Glicemia", urgent: true }];

function setup() {
  const fx = createAppointmentsFixtures(new FixedClock(NOW));
  fx.clinics.seed(CLINIC, "Clínica Sol", "");
  fx.clinics.seedSlot({ id: "slot-1", clinicId: CLINIC, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: new Date(NOW.getTime() + 3_600_000), durationMinutes: 30, capacity: 1, professionalId: "prof-1", professionalName: "Dr. João" });
  fx.memberNames.seed("fam", "mem", "Maria Silva");
  const seed = (id: string, status: Appointment["status"] = "SCHEDULED") => { fx.appointmentsRepo.seed({ id, familyId: "fam", memberId: "mem", scheduledAt: new Date(NOW.getTime() + 3_600_000), status, confirmationStatus: "PENDING", clinicId: CLINIC, slotId: "slot-1", createdAt: NOW }); };
  seed("apt-1");
  seed("apt-2");
  return { fx, complete: createCompleteClinicAppointmentUseCase(fx.deps), list: createListClinicAgendaUseCase(fx.deps) };
}

describe("complete com examOrders (BR-CLN-51)", () => {
  it("conclui e chama a porta na mesma operação; a vista traz examOrderCount; a auditoria só traz a contagem", async () => {
    const { fx, complete } = setup();
    const view = await complete(DOCTOR, "apt-1", { outcomeNote: "ok", examOrders: ORDERS }, CTX);
    expect(view).toMatchObject({ status: "COMPLETED", examOrderCount: 2 });
    expect(fx.consultationReports.examOrdersCreated).toEqual([{ kind: "APPOINTMENT", bookingId: "apt-1", examOrders: ORDERS, actor: DOCTOR }]);
    const audit = fx.audit.events.find((e) => e.action === "APPOINTMENT_STATUS");
    expect(audit?.metadata).toMatchObject({ to: "COMPLETED", examOrderCount: 2 });
    expect(JSON.stringify(fx.audit.events)).not.toContain("Hemograma");
  });

  it("report e examOrders juntos: ambos na mesma conclusão", async () => {
    const { fx, complete } = setup();
    const view = await complete(DOCTOR, "apt-1", { outcomeNote: "ok", report: { reason: "Dor" }, examOrders: ORDERS }, CTX);
    expect(view).toMatchObject({ status: "COMPLETED", reportStatus: "FINAL", examOrderCount: 2 });
    expect(fx.consultationReports.finalized).toHaveLength(1);
  });

  it("sem examOrders: a porta não é chamada e a contagem é 0 (campo omitido => 0 no DTO)", async () => {
    const { fx, complete } = setup();
    const view = await complete(DOCTOR, "apt-1", { outcomeNote: "ok" }, CTX);
    expect(fx.consultationReports.examOrdersCreated).toEqual([]);
    expect(view.examOrderCount).toBeUndefined();
    expect(fx.audit.events.find((e) => e.action === "APPOINTMENT_STATUS")?.metadata).toMatchObject({ examOrderCount: 0 });
  });

  it("Admin/Gestor com examOrders => FORBIDDEN da porta (a transação do chamador reverte)", async () => {
    const { fx, complete } = setup();
    await expect(complete(ADMIN, "apt-1", { outcomeNote: "ok", examOrders: ORDERS }, CTX)).rejects.toBeInstanceOf(ForbiddenError);
    expect(fx.consultationReports.examOrdersCreated).toEqual([]);
  });

  it("falha da porta (inválido, >5 ativos…) propaga-se: a conclusão falha", async () => {
    const { fx, complete } = setup();
    fx.consultationReports.failExamOrdersWith = new Error("pedido inválido");
    await expect(complete(DOCTOR, "apt-1", { examOrders: [] }, CTX)).rejects.toThrow("pedido inválido");
  });

  it("visita manual: mesmo caminho (kind VISIT)", async () => {
    const { fx, complete } = setup();
    fx.clinicPatients.visits.set("visit-1", {
      id: "visit-1", status: "SCHEDULED", scheduledAt: NOW.toISOString(), patientName: "Zé", source: "MANUAL", clinicPatientId: "cp", clinicId: CLINIC, slotId: "slot-1",
      confirmationStatus: "PENDING", dayState: "SCHEDULED",
    });
    const view = await complete(DOCTOR, "visit-1", { outcomeNote: null, examOrders: ORDERS }, CTX);
    expect(view).toMatchObject({ source: "MANUAL", examOrderCount: 2 });
    expect(fx.consultationReports.examOrdersCreated.map((f) => f.kind)).toEqual(["VISIT"]);
  });
});

describe("ClinicBooking.examOrderCount na agenda", () => {
  it("conta pedidos por marcação para os três papéis; ausente se não há", async () => {
    const { fx, list } = setup();
    fx.consultationReports.orderCounts.set("apt-1", 3);
    expect((await list(ADMIN, {})).map((v) => [v.id, v.examOrderCount])).toEqual([["apt-1", 3], ["apt-2", undefined]]);
    expect((await list(DOCTOR, {})).map((v) => v.examOrderCount)).toEqual([3, undefined]);
  });
});

describe("Appointment.examOrderCount (BR-CLN-53, authorization.md §6.7)", () => {
  const ACTOR = { userId: "u1", platformAdmin: false };

  it.each([
    ["SELF", 2],
    ["TUTOR_OF", 2],
    ["DEPENDENT_SELF", 0],
    ["OTHER", 0],
  ] as const)("relação %s => examOrderCount %s (get e lista)", async (relation, expected) => {
    const { fx } = setup();
    fx.policy.relation = relation;
    fx.consultationReports.orderCounts.set("apt-1", 2);
    const get = await createGetAppointmentUseCase(fx.deps)(ACTOR, "fam", "mem", "apt-1", CTX);
    expect(get.examOrderCount ?? 0).toBe(expected);
    const list = await createListAppointmentsUseCase(fx.deps)(ACTOR, "fam", "mem", {}, CTX);
    expect(list.items.find((a) => a.id === "apt-1")?.examOrderCount ?? 0).toBe(expected);
    expect(list.items.find((a) => a.id === "apt-2")?.examOrderCount ?? 0).toBe(0);
  });
});
