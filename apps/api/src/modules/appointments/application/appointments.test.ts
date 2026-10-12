import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCancelClinicAppointmentUseCase, createListClinicAgendaUseCase, createListClinicRequestsUseCase, createRespondClinicRequestUseCase } from "./clinic-appointments.js";
import { createCreateAppointmentUseCase } from "./create-appointment.js";
import { createDeleteAppointmentUseCase } from "./delete-appointment.js";
import { createAppointmentsFixtures } from "./fixtures.js";
import { createGetAppointmentUseCase } from "./get-appointment.js";
import { createListAppointmentsUseCase } from "./list-appointments.js";
import { createListAvailableSlotsUseCase } from "./list-available-slots.js";
import { createSetAppointmentStatusUseCase } from "./set-appointment-status.js";
import { createUpdateAppointmentUseCase } from "./update-appointment.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };

describe("createAppointment (UC-APT-01, BR-APT-02)", () => {
  it("cria uma consulta futura SCHEDULED por omissão", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);

    const appointment = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);

    expect(appointment.status).toBe("SCHEDULED");
    expect(fixtures.audit.events.some((e) => e.action === "APPOINTMENT_CREATE")).toBe(true);
  });

  it("BR-APT-02: data passada sem status explícito permanece SCHEDULED (nunca assume o desfecho)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);

    const appointment = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-01-01T09:00:00.000Z" }, CTX);

    expect(appointment.status).toBe("SCHEDULED");
  });

  it("UC-APT-01 alternativo: registo retroativo pode nascer COMPLETED explicitamente", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);

    const appointment = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-01-01T09:00:00.000Z", status: "COMPLETED" }, CTX);

    expect(appointment.status).toBe("COMPLETED");
  });

  it("congela o nome da clínica selecionada (BR-CLN-02)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    fixtures.clinics.seed("clinic-1", "Clínica Sol", FAMILY_ID);
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);

    const appointment = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z", clinicId: "clinic-1", clinicName: "nome que devia ser ignorado" }, CTX);

    expect(appointment.clinicId).toBe("clinic-1");
    expect(appointment.clinicName).toBe("Clínica Sol");
  });

  it("recusa clínica arquivada/inexistente/de outra família (VALIDATION_ERROR)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    fixtures.clinics.seed("clinic-1", "Clínica Sol", "other-family");
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);

    await expect(createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z", clinicId: "clinic-1" }, CTX)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("aceita entrada privada ad hoc (só clinicName, sem clinicId)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);

    const appointment = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z", clinicName: "Consultório do Dr. Costa" }, CTX);

    expect(appointment.clinicId).toBeUndefined();
    expect(appointment.clinicName).toBe("Consultório do Dr. Costa");
  });

  it("recusa data/hora inválida (VALIDATION_ERROR)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);

    await expect(createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "não-é-uma-data" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("listAppointments/getAppointment (audit.md §3)", () => {
  it("lê por tutor é auditado (HEALTH_VIEW); lê pelo próprio titular não", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const getAppointment = createGetAppointmentUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);

    fixtures.policy.relation = "SELF";
    await getAppointment(ACTOR, FAMILY_ID, MEMBER_ID, created.id, CTX);
    expect(fixtures.audit.events.some((e) => e.action === "HEALTH_VIEW")).toBe(false);

    fixtures.policy.relation = "TUTOR_OF";
    await getAppointment(ACTOR, FAMILY_ID, MEMBER_ID, created.id, CTX);
    expect(fixtures.audit.events.some((e) => e.action === "HEALTH_VIEW")).toBe(true);
  });

  it("getAppointment devolve NOT_FOUND para consulta de outra família", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const getAppointment = createGetAppointmentUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);

    await expect(getAppointment(ACTOR, "other", MEMBER_ID, created.id, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listAppointments filtra por estado e período", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const listAppointments = createListAppointmentsUseCase(fixtures.deps);
    await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);
    await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-01-01T09:00:00.000Z", status: "COMPLETED" }, CTX);

    const scheduled = await listAppointments(ACTOR, FAMILY_ID, MEMBER_ID, { status: "SCHEDULED" }, CTX);
    expect(scheduled.items).toHaveLength(1);

    const future = await listAppointments(ACTOR, FAMILY_ID, MEMBER_ID, { from: "2026-01-15T00:00:00.000Z" }, CTX);
    expect(future.items).toHaveLength(1);
    expect(future.items[0]?.status).toBe("SCHEDULED");
  });
});

describe("updateAppointment (reagendar)", () => {
  it("altera a hora e a clínica, recalculando o snapshot do nome", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    fixtures.clinics.seed("clinic-1", "Clínica Sol", FAMILY_ID);
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const updateAppointment = createUpdateAppointmentUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);

    const updated = await updateAppointment(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { scheduledAt: "2026-02-02T10:00:00.000Z", clinicId: "clinic-1" }, CTX);

    expect(updated.scheduledAt.toISOString()).toBe("2026-02-02T10:00:00.000Z");
    expect(updated.clinicName).toBe("Clínica Sol");
    expect(fixtures.audit.events.some((e) => e.action === "APPOINTMENT_UPDATE")).toBe(true);
  });

  it("recusa remover a data (scheduledAt: null)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const updateAppointment = createUpdateAppointmentUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);

    await expect(updateAppointment(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { scheduledAt: null }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("setAppointmentStatus (ST4)", () => {
  it("permite SCHEDULED -> COMPLETED -> NO_SHOW (correção)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const setStatus = createSetAppointmentStatusUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);

    const completed = await setStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "COMPLETED" }, CTX);
    expect(completed.status).toBe("COMPLETED");

    const corrected = await setStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "NO_SHOW" }, CTX);
    expect(corrected.status).toBe("NO_SHOW");
  });

  it("recusa transição inválida (CANCELLED -> COMPLETED)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const setStatus = createSetAppointmentStatusUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);
    await setStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "CANCELLED" }, CTX);

    await expect(setStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "COMPLETED" }, CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("AC-APT-02: nunca muda de estado por si só (sem job de scanner neste módulo)", async () => {
    const clock = new FixedClock(NOW);
    const fixtures = createAppointmentsFixtures(clock);
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const getAppointment = createGetAppointmentUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-01-01T09:00:00.000Z" }, CTX);

    clock.advance(48 * 60 * 60 * 1000); // 48h depois da consulta passada
    const fetched = await getAppointment(ACTOR, FAMILY_ID, MEMBER_ID, created.id, CTX);
    expect(fetched.status).toBe("SCHEDULED");
  });
});

describe("deleteAppointment (UC-APT-06)", () => {
  it("elimina e audita", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const deleteAppointment = createDeleteAppointmentUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z" }, CTX);

    await deleteAppointment(ACTOR, FAMILY_ID, MEMBER_ID, created.id, CTX);

    expect(fixtures.appointmentsRepo.byId.has(created.id)).toBe(false);
    expect(fixtures.audit.events.some((e) => e.action === "APPOINTMENT_DELETE")).toBe(true);
  });

  it("devolve NOT_FOUND para consulta inexistente", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const deleteAppointment = createDeleteAppointmentUseCase(fixtures.deps);
    await expect(deleteAppointment(ACTOR, FAMILY_ID, MEMBER_ID, "nope", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

const CLINIC_ID = "clinic-1";
const CLINIC_ACTOR = { clinicAccountId: "clinic-account-1", clinicId: CLINIC_ID };

function seedFreeSlot(fixtures: ReturnType<typeof createAppointmentsFixtures>, id: string, overrides: Partial<{ specialty: string; startsAt: Date; durationMinutes: number; professionalName?: string }> = {}) {
  fixtures.clinics.seed(CLINIC_ID, "Clínica Sol", FAMILY_ID);
  fixtures.clinics.seedSlot({
    id,
    clinicId: CLINIC_ID,
    specialty: overrides.specialty ?? "Cardiologia",
    startsAt: overrides.startsAt ?? new Date("2026-02-01T09:00:00.000Z"),
    durationMinutes: overrides.durationMinutes ?? 30,
    ...(overrides.professionalName ? { professionalName: overrides.professionalName } : {}),
  });
}

describe("createAppointment com slotId (UC-APT-07, D17/BR-APT-04/06)", () => {
  it("cria REQUESTED a partir do horário, congelando data/especialidade/clínica", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    seedFreeSlot(fixtures, "slot-1", { professionalName: "Dr. Costa" });
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);

    const appointment = await createAppointment(
      ACTOR,
      FAMILY_ID,
      MEMBER_ID,
      { scheduledAt: "1999-01-01T00:00:00.000Z", clinicId: CLINIC_ID, slotId: "slot-1", notes: "dores de cabeça" },
      CTX,
    );

    expect(appointment.status).toBe("REQUESTED");
    expect(appointment.slotId).toBe("slot-1");
    expect(appointment.clinicId).toBe(CLINIC_ID);
    expect(appointment.clinicName).toBe("Clínica Sol");
    expect(appointment.specialty).toBe("Cardiologia");
    expect(appointment.professionalName).toBe("Dr. Costa");
    expect(appointment.scheduledAt.toISOString()).toBe("2026-02-01T09:00:00.000Z");
    expect(appointment.notes).toBe("dores de cabeça");
  });

  it("recusa slotId sem clinicId (VALIDATION_ERROR)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);

    await expect(createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z", slotId: "slot-1" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("recusa horário inexistente/de outra clínica (VALIDATION_ERROR)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    fixtures.clinics.seed(CLINIC_ID, "Clínica Sol", FAMILY_ID);
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);

    await expect(
      createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "2026-02-01T09:00:00.000Z", clinicId: CLINIC_ID, slotId: "nope" }, CTX),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("BR-APT-06: recusa horário já com marcação ativa (CONFLICT)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    seedFreeSlot(fixtures, "slot-1");
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "x", clinicId: CLINIC_ID, slotId: "slot-1" }, CTX);

    await expect(createAppointment(ACTOR, FAMILY_ID, "m2", { scheduledAt: "x", clinicId: CLINIC_ID, slotId: "slot-1" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("updateAppointment numa consulta de clínica parceira (BR-APT-09)", () => {
  it("recusa mudar scheduledAt/clinicId/specialty; aceita notes", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    seedFreeSlot(fixtures, "slot-1");
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const updateAppointment = createUpdateAppointmentUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "x", clinicId: CLINIC_ID, slotId: "slot-1" }, CTX);

    await expect(updateAppointment(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { scheduledAt: "2026-03-01T09:00:00.000Z" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const updated = await updateAppointment(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { notes: "nova observação" }, CTX);
    expect(updated.notes).toBe("nova observação");
  });
});

describe("setAppointmentStatus numa consulta REQUESTED (D17)", () => {
  it("só permite desistir (REQUESTED -> CANCELLED); recusa SCHEDULED/REJECTED", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    seedFreeSlot(fixtures, "slot-1");
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const setStatus = createSetAppointmentStatusUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "x", clinicId: CLINIC_ID, slotId: "slot-1" }, CTX);

    await expect(setStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "SCHEDULED" }, CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(setStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "REJECTED" }, CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    const cancelled = await setStatus(ACTOR, FAMILY_ID, MEMBER_ID, created.id, { status: "CANCELLED" }, CTX);
    expect(cancelled.status).toBe("CANCELLED");
  });
});

describe("listAvailableSlots (D17, FAM_MEMBER)", () => {
  it("devolve só horários sem marcação ativa", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    seedFreeSlot(fixtures, "slot-1");
    seedFreeSlot(fixtures, "slot-2", { startsAt: new Date("2026-02-02T09:00:00.000Z") });
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "x", clinicId: CLINIC_ID, slotId: "slot-1" }, CTX);
    const listAvailableSlots = createListAvailableSlotsUseCase(fixtures.deps);

    const result = await listAvailableSlots(ACTOR, FAMILY_ID, CLINIC_ID, {});

    expect(result.clinicName).toBe("Clínica Sol");
    expect(result.items.map((slot) => slot.id)).toEqual(["slot-2"]);
  });

  it("devolve NOT_FOUND para clínica inexistente/não visível à família", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    const listAvailableSlots = createListAvailableSlotsUseCase(fixtures.deps);
    await expect(listAvailableSlots(ACTOR, FAMILY_ID, "nope", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Portal da clínica — pedidos e agenda (D17/BR-CLN-03)", () => {
  it("listClinicRequests só mostra pedidos REQUESTED da própria clínica, com o mínimo necessário", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    seedFreeSlot(fixtures, "slot-1");
    fixtures.memberNames.seed(FAMILY_ID, MEMBER_ID, "Maria Silva");
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "x", clinicId: CLINIC_ID, slotId: "slot-1", notes: "check-up" }, CTX);
    const listClinicRequests = createListClinicRequestsUseCase(fixtures.deps);

    const requests = await listClinicRequests(CLINIC_ACTOR);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ status: "REQUESTED", patientName: "Maria Silva", specialty: "Cardiologia", notes: "check-up" });
  });

  it("respondClinicRequest confirma (-> SCHEDULED) e recusa (-> REJECTED, horário volta a ficar livre)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    seedFreeSlot(fixtures, "slot-1");
    seedFreeSlot(fixtures, "slot-2", { startsAt: new Date("2026-02-03T09:00:00.000Z") });
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const confirmed = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "x", clinicId: CLINIC_ID, slotId: "slot-1" }, CTX);
    const rejected = await createAppointment(ACTOR, FAMILY_ID, "m2", { scheduledAt: "x", clinicId: CLINIC_ID, slotId: "slot-2" }, CTX);
    const respond = createRespondClinicRequestUseCase(fixtures.deps);

    const confirmResult = await respond(CLINIC_ACTOR, confirmed.id, { decision: "CONFIRM" }, CTX);
    expect(confirmResult.status).toBe("SCHEDULED");

    const rejectResult = await respond(CLINIC_ACTOR, rejected.id, { decision: "REJECT", note: "sem vaga" }, CTX);
    expect(rejectResult.status).toBe("REJECTED");
    expect(rejectResult.responseNote).toBe("sem vaga");

    const listAvailableSlots = createListAvailableSlotsUseCase(fixtures.deps);
    const free = await listAvailableSlots(ACTOR, FAMILY_ID, CLINIC_ID, {});
    expect(free.items.map((slot) => slot.id)).toEqual(["slot-2"]);
  });

  it("respondClinicRequest recusa responder duas vezes (CONFLICT) e nunca vê pedido de outra clínica (NOT_FOUND)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    seedFreeSlot(fixtures, "slot-1");
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "x", clinicId: CLINIC_ID, slotId: "slot-1" }, CTX);
    const respond = createRespondClinicRequestUseCase(fixtures.deps);
    await respond(CLINIC_ACTOR, created.id, { decision: "CONFIRM" }, CTX);

    await expect(respond(CLINIC_ACTOR, created.id, { decision: "CONFIRM" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(respond({ clinicAccountId: "other", clinicId: "other-clinic" }, created.id, { decision: "CONFIRM" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("listClinicAgenda e cancelClinicAppointment (UC-CLN-06)", async () => {
    const fixtures = createAppointmentsFixtures(new FixedClock(NOW));
    seedFreeSlot(fixtures, "slot-1");
    const createAppointment = createCreateAppointmentUseCase(fixtures.deps);
    const created = await createAppointment(ACTOR, FAMILY_ID, MEMBER_ID, { scheduledAt: "x", clinicId: CLINIC_ID, slotId: "slot-1" }, CTX);
    const respond = createRespondClinicRequestUseCase(fixtures.deps);
    await respond(CLINIC_ACTOR, created.id, { decision: "CONFIRM" }, CTX);

    const listClinicAgenda = createListClinicAgendaUseCase(fixtures.deps);
    const agenda = await listClinicAgenda(CLINIC_ACTOR, {});
    expect(agenda).toHaveLength(1);
    expect(agenda[0]?.status).toBe("SCHEDULED");

    const cancel = createCancelClinicAppointmentUseCase(fixtures.deps);
    await expect(cancel(CLINIC_ACTOR, created.id, { note: "" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    const cancelled = await cancel(CLINIC_ACTOR, created.id, { note: "sala indisponível" }, CTX);
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.responseNote).toBe("sala indisponível");
  });
});
