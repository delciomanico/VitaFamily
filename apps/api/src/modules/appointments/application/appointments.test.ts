import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCreateAppointmentUseCase } from "./create-appointment.js";
import { createDeleteAppointmentUseCase } from "./delete-appointment.js";
import { createAppointmentsFixtures } from "./fixtures.js";
import { createGetAppointmentUseCase } from "./get-appointment.js";
import { createListAppointmentsUseCase } from "./list-appointments.js";
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
