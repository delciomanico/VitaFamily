// AC-CLN-30/31 / TC-CLN-21/22 (aplicação, M15 S, BR-CLN-42/45): `report` em `complete` chama a porta na MESMA transação (falha de
// qualquer parte => nada muda), `complete` sem `report` não toca no rascunho, `reportStatus` na agenda e `reportAvailable` do lado
// família só para SELF/TUTOR_OF. As regras do relatório testam-se em `clinic-reports`.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ForbiddenError } from "../../../platform/errors/index.js";
import type { Appointment } from "../domain/appointment.js";
import { createCompleteClinicAppointmentUseCase, createListClinicAgendaUseCase } from "./clinic-appointments.js";
import { createAppointmentsFixtures } from "./fixtures.js";
import { createGetAppointmentUseCase } from "./get-appointment.js";
import { createListAppointmentsUseCase } from "./list-appointments.js";
import type { ClinicPortalActor } from "./ports.js";

const NOW = new Date("2026-11-08T09:00:00Z");
const CLINIC = "clinic-a";
const CTX = { requestId: "req-1" };
const ADMIN: ClinicPortalActor = { clinicAccountId: "admin", clinicId: CLINIC };
const DOCTOR: ClinicPortalActor = { clinicAccountId: "doc", clinicId: CLINIC, professionalId: "prof-1" };
const REPORT = { reason: "Dor", impression: "Lombalgia" };

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

describe("complete com report (BR-CLN-42)", () => {
  it("com report: conclui e chama a porta na mesma operação; a vista traz reportStatus=FINAL; a auditoria diz hasReport sem texto", async () => {
    const { fx, complete } = setup();
    const view = await complete(DOCTOR, "apt-1", { outcomeNote: "ok", report: REPORT }, CTX);
    expect(view).toMatchObject({ status: "COMPLETED", reportStatus: "FINAL" });
    expect(fx.consultationReports.finalized).toEqual([{ kind: "APPOINTMENT", bookingId: "apt-1", report: REPORT, actor: DOCTOR }]);
    const audit = fx.audit.events.find((e) => e.action === "APPOINTMENT_STATUS");
    expect(audit?.metadata).toMatchObject({ to: "COMPLETED", hasReport: true });
    expect(JSON.stringify(fx.audit.events)).not.toContain("Lombalgia");
  });

  it("sem report: a porta não é chamada e o rascunho não se toca", async () => {
    const { fx, complete } = setup();
    fx.consultationReports.statusesById.set("apt-1", "DRAFT");
    const view = await complete(DOCTOR, "apt-1", { outcomeNote: "ok" }, CTX);
    expect(view).toMatchObject({ status: "COMPLETED", reportStatus: "DRAFT" });
    expect(fx.consultationReports.finalized).toEqual([]);
    expect(fx.consultationReports.statusesById.get("apt-1")).toBe("DRAFT");
  });

  it("Admin/Gestor com report => FORBIDDEN da porta (a transação reverte; nada fica gravado pela porta)", async () => {
    const { fx, complete } = setup();
    await expect(complete(ADMIN, "apt-1", { outcomeNote: "ok", report: REPORT }, CTX)).rejects.toBeInstanceOf(ForbiddenError);
    expect(fx.consultationReports.finalized).toEqual([]);
  });

  it("falha da porta (relatório inválido, já FINAL…) propaga-se: a conclusão falha", async () => {
    const { fx, complete } = setup();
    fx.consultationReports.failWith = new Error("relatório inválido");
    await expect(complete(DOCTOR, "apt-1", { report: {} }, CTX)).rejects.toThrow("relatório inválido");
  });

  it("a visita manual segue o mesmo caminho (kind VISIT) depois de concluída pelo módulo dos pacientes", async () => {
    const { fx, complete } = setup();
    fx.clinicPatients.visits.set("visit-1", {
      id: "visit-1", status: "SCHEDULED", scheduledAt: NOW.toISOString(), patientName: "Zé", source: "MANUAL", clinicPatientId: "cp", clinicId: CLINIC, slotId: "slot-1",
      confirmationStatus: "PENDING", dayState: "SCHEDULED",
    });
    const view = await complete(DOCTOR, "visit-1", { outcomeNote: null, report: REPORT }, CTX);
    expect(view).toMatchObject({ source: "MANUAL", reportStatus: "FINAL" });
    expect(fx.consultationReports.finalized.map((f) => f.kind)).toEqual(["VISIT"]);
  });
});

describe("ClinicBooking.reportStatus na agenda", () => {
  it("indica DRAFT/FINAL por marcação para os três papéis; nulo se não existe", async () => {
    const { fx, list } = setup();
    fx.consultationReports.statusesById.set("apt-1", "FINAL");
    fx.consultationReports.statusesById.set("apt-2", "DRAFT");
    expect((await list(ADMIN, {})).map((v) => [v.id, v.reportStatus])).toEqual([["apt-1", "FINAL"], ["apt-2", "DRAFT"]]);
    expect((await list(DOCTOR, {})).map((v) => v.reportStatus)).toEqual(["FINAL", "DRAFT"]);
    fx.consultationReports.statusesById.clear();
    expect((await list(ADMIN, {})).every((v) => v.reportStatus === undefined)).toBe(true);
  });
});

describe("Appointment.reportAvailable (BR-CLN-45, authorization.md §6.6)", () => {
  const ACTOR = { userId: "u1", platformAdmin: false };

  it.each([
    ["SELF", true],
    ["TUTOR_OF", true],
    ["DEPENDENT_SELF", false],
    ["OTHER", false],
  ] as const)("relação %s => reportAvailable %s (get e lista), mesmo com relatório FINAL partilhado", async (relation, expected) => {
    const { fx } = setup();
    fx.policy.relation = relation;
    fx.consultationReports.shared.add("apt-1");
    const get = await createGetAppointmentUseCase(fx.deps)(ACTOR, "fam", "mem", "apt-1", CTX);
    expect(get.reportAvailable ?? false).toBe(expected);
    const list = await createListAppointmentsUseCase(fx.deps)(ACTOR, "fam", "mem", {}, CTX);
    expect(list.items.find((a) => a.id === "apt-1")?.reportAvailable ?? false).toBe(expected);
    expect(list.items.find((a) => a.id === "apt-2")?.reportAvailable ?? false).toBe(false);
  });
});
