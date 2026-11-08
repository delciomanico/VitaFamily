// TC-CLN-13/15/16 (AC-CLN-20/22/24): confirmação do paciente ("Vou" / "Não posso"), confirmação por telefone, Chegou/Iniciar/Faltou,
// concluir e retorno sobre consultas Vita e visitas manuais (despacho por id). Fakes em memória, relógio fixo.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ForbiddenError } from "../../../platform/errors/index.js";
import type { Appointment } from "../domain/appointment.js";
import { createSetAppointmentConfirmationUseCase } from "./set-appointment-confirmation.js";
import {
  createArriveClinicAppointmentUseCase,
  createClearClinicFollowUpUseCase,
  createConfirmClinicAppointmentByPhoneUseCase,
  createNoShowClinicAppointmentUseCase,
  createSetClinicFollowUpUseCase,
  createStartClinicAppointmentUseCase,
} from "./clinic-day-flow.js";
import { createCompleteClinicAppointmentUseCase, createListClinicAgendaUseCase } from "./clinic-appointments.js";
import { createAppointmentsFixtures } from "./fixtures.js";
import { createSetAppointmentStatusUseCase } from "./set-appointment-status.js";
import { createUpdateAppointmentUseCase } from "./update-appointment.js";
import { createCreateWalkInAppointmentUseCase } from "./clinic-walk-in.js";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const CTX = { requestId: "req-1", ip: "10.0.0.1" };
const FAMILY = "fam-1";
const MEMBER = "mem-1";
const USER = { userId: "u1", platformAdmin: false };
const CLINIC = "clinic-a";
const ACTOR = { clinicAccountId: "acc-a", clinicId: CLINIC };
const OTHER_ACTOR = { clinicAccountId: "acc-b", clinicId: "clinic-b" };

function appt(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "apt-1",
    familyId: FAMILY,
    memberId: MEMBER,
    scheduledAt: new Date("2026-11-10T09:00:00.000Z"),
    status: "SCHEDULED",
    confirmationStatus: "PENDING",
    clinicId: CLINIC,
    slotId: "slot-1",
    createdAt: new Date("2026-11-01T09:00:00.000Z"),
    ...overrides,
  };
}

function setup(clock = new FixedClock(NOW)) {
  const fx = createAppointmentsFixtures(clock);
  fx.memberNames.seed(FAMILY, MEMBER, "Maria Santos Silva");
  fx.clinics.seed(CLINIC, "Clínica Sol", "");
  return { clock, fx };
}

describe("setAppointmentConfirmation (AC-CLN-20, BR-CLN-26)", () => {
  it("GOING => CONFIRMED (PATIENT) e é idempotente; auditoria só com `response`", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt());
    const confirm = createSetAppointmentConfirmationUseCase(fx.deps);
    const first = await confirm(USER, FAMILY, MEMBER, "apt-1", { response: "GOING" }, CTX);
    expect(first).toMatchObject({ status: "SCHEDULED", confirmationStatus: "CONFIRMED", confirmationSource: "PATIENT" });
    expect(first.confirmedAt?.toISOString()).toBe(NOW.toISOString());
    const again = await confirm(USER, FAMILY, MEMBER, "apt-1", { response: "GOING" }, CTX);
    expect(again.confirmationStatus).toBe("CONFIRMED");
    const events = fx.audit.events.filter((e) => e.action === "APPOINTMENT_CONFIRMATION_SET");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorType: "USER", actorUserId: "u1", familyId: FAMILY, subjectMemberId: MEMBER, metadata: { response: "GOING" } });
    expect(fx.policy.calls[0]).toMatchObject({ action: "UPDATE", category: "APPOINTMENTS", subjectMemberId: MEMBER });
  });

  it("CANNOT cancela a consulta, marca DECLINED, liberta o horário e repetir é idempotente", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt());
    const confirm = createSetAppointmentConfirmationUseCase(fx.deps);
    const result = await confirm(USER, FAMILY, MEMBER, "apt-1", { response: "CANNOT" }, CTX);
    expect(result).toMatchObject({ status: "CANCELLED", confirmationStatus: "DECLINED" });
    expect(result.confirmationSource).toBeUndefined();
    expect(await fx.appointmentsRepo.findActiveBySlot({}, "slot-1")).toBeNull();
    expect((await confirm(USER, FAMILY, MEMBER, "apt-1", { response: "CANNOT" }, CTX)).status).toBe("CANCELLED");
    expect(fx.audit.events.filter((e) => e.action === "APPOINTMENT_CONFIRMATION_SET")).toHaveLength(1);
  });

  it("CANNOT depois de CONFIRMED é permitido; GOING depois de CANNOT => INVALID_STATE_TRANSITION", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt({ confirmationStatus: "CONFIRMED", confirmationSource: "CLINIC", confirmedAt: NOW }));
    const confirm = createSetAppointmentConfirmationUseCase(fx.deps);
    expect((await confirm(USER, FAMILY, MEMBER, "apt-1", { response: "CANNOT" }, CTX)).confirmationStatus).toBe("DECLINED");
    await expect(confirm(USER, FAMILY, MEMBER, "apt-1", { response: "GOING" }, CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("a última resposta prevalece: GOING depois de 'confirmado por telefone' passa a PATIENT", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt({ confirmationStatus: "CONFIRMED", confirmationSource: "CLINIC", confirmedAt: new Date("2026-11-07T09:00:00.000Z") }));
    const result = await createSetAppointmentConfirmationUseCase(fx.deps)(USER, FAMILY, MEMBER, "apt-1", { response: "GOING" }, CTX);
    expect(result).toMatchObject({ confirmationStatus: "CONFIRMED", confirmationSource: "PATIENT" });
  });

  it.each<[string, Partial<Appointment>, string]>([
    ["passada", { scheduledAt: new Date("2026-11-08T11:00:00.000Z") }, "INVALID_STATE_TRANSITION"],
    ["COMPLETED", { status: "COMPLETED" }, "INVALID_STATE_TRANSITION"],
    ["REQUESTED", { status: "REQUESTED" }, "INVALID_STATE_TRANSITION"],
  ])("consulta %s => %s", async (_name, overrides, code) => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt(overrides));
    await expect(createSetAppointmentConfirmationUseCase(fx.deps)(USER, FAMILY, MEMBER, "apt-1", { response: "GOING" }, CTX)).rejects.toMatchObject({ code });
  });

  it("sem clínica parceira (sem slotId) => VALIDATION_ERROR; resposta inválida => VALIDATION_ERROR", async () => {
    const { fx } = setup();
    const privateAppointment = appt();
    delete privateAppointment.slotId;
    fx.appointmentsRepo.seed(privateAppointment);
    const confirm = createSetAppointmentConfirmationUseCase(fx.deps);
    await expect(confirm(USER, FAMILY, MEMBER, "apt-1", { response: "GOING" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(confirm(USER, FAMILY, MEMBER, "apt-1", { response: "TALVEZ" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("consulta de outra família/membro => NOT_FOUND; OTHER (política) => FORBIDDEN e nada muda", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt());
    const confirm = createSetAppointmentConfirmationUseCase(fx.deps);
    await expect(confirm(USER, "outra-familia", MEMBER, "apt-1", { response: "GOING" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    fx.policy.denyWith = new ForbiddenError({ detail: "Sem permissão." });
    await expect(confirm(USER, FAMILY, MEMBER, "apt-1", { response: "GOING" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await fx.appointmentsRepo.findById({}, FAMILY, MEMBER, "apt-1"))?.confirmationStatus).toBe("PENDING");
    expect(fx.audit.events).toHaveLength(0);
  });

  it("reativar (CANCELLED -> SCHEDULED) repõe PENDING; mudar a hora repõe e anula chegada/início (BR-CLN-25)", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt());
    await createSetAppointmentConfirmationUseCase(fx.deps)(USER, FAMILY, MEMBER, "apt-1", { response: "CANNOT" }, CTX);
    const reactivated = await createSetAppointmentStatusUseCase(fx.deps)(USER, FAMILY, MEMBER, "apt-1", { status: "SCHEDULED" }, CTX);
    expect(reactivated).toMatchObject({ status: "SCHEDULED", confirmationStatus: "PENDING" });

    // consulta privada confirmada pela clínica por telefone não existe; usa uma com hora editável
    const editable = appt({ id: "apt-2", confirmationStatus: "CONFIRMED", confirmationSource: "CLINIC", confirmedAt: NOW, arrivedAt: NOW });
    delete editable.slotId;
    fx.appointmentsRepo.seed(editable);
    const same = await createUpdateAppointmentUseCase(fx.deps)(USER, FAMILY, MEMBER, "apt-2", { scheduledAt: editable.scheduledAt.toISOString(), notes: "x" }, CTX);
    expect(same.confirmationStatus).toBe("CONFIRMED");
    const moved = await createUpdateAppointmentUseCase(fx.deps)(USER, FAMILY, MEMBER, "apt-2", { scheduledAt: "2026-11-12T09:00:00.000Z" }, CTX);
    expect(moved.confirmationStatus).toBe("PENDING");
    expect(moved.arrivedAt).toBeUndefined();
    expect(moved.confirmationSource).toBeUndefined();
  });
});

describe("confirmação por telefone, Chegou, Iniciar, Faltou (AC-CLN-22, BR-CLN-27/28)", () => {
  it("consulta Vita: confirm (idempotente), arrive, start e dayState derivado; estado Vita continua SCHEDULED", async () => {
    const { fx, clock } = setup();
    fx.appointmentsRepo.seed(appt({ scheduledAt: new Date("2026-11-08T15:00:00.000Z") }));
    const confirm = createConfirmClinicAppointmentByPhoneUseCase(fx.deps);
    const arrive = createArriveClinicAppointmentUseCase(fx.deps);
    const start = createStartClinicAppointmentUseCase(fx.deps);

    const confirmed = await confirm(ACTOR, "apt-1", CTX);
    expect(confirmed).toMatchObject({ confirmationStatus: "CONFIRMED", confirmationSource: "CLINIC", dayState: "SCHEDULED", source: "VITA" });
    await confirm(ACTOR, "apt-1", CTX);
    expect(fx.audit.events.filter((e) => e.action === "CLINIC_APPOINTMENT_CONFIRM")).toHaveLength(1);

    const arrived = await arrive(ACTOR, "apt-1", CTX);
    expect(arrived).toMatchObject({ status: "SCHEDULED", dayState: "ARRIVED", arrivedAt: NOW.toISOString(), waitingMinutes: 0 });
    clock.advance(7 * 60_000 + 30_000);
    const repeated = await arrive(ACTOR, "apt-1", CTX);
    expect(repeated.arrivedAt).toBe(NOW.toISOString());
    expect(repeated.waitingMinutes).toBe(7);
    expect(fx.audit.events.filter((e) => e.action === "CLINIC_APPOINTMENT_ARRIVE")).toHaveLength(1);

    const started = await start(ACTOR, "apt-1", CTX);
    expect(started).toMatchObject({ status: "SCHEDULED", dayState: "IN_PROGRESS", waitingMinutes: 7 });
    clock.advance(60 * 60_000);
    expect((await start(ACTOR, "apt-1", CTX)).startedAt).toBe(started.startedAt);
    expect((await fx.appointmentsRepo.findByClinicId({}, CLINIC, "apt-1"))?.status).toBe("SCHEDULED");
  });

  it("Iniciar sem Chegou regista as duas; auditoria sem família/membro nem PII", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt({ scheduledAt: new Date("2026-11-08T15:00:00.000Z") }));
    const view = await createStartClinicAppointmentUseCase(fx.deps)(ACTOR, "apt-1", CTX);
    expect(view).toMatchObject({ dayState: "IN_PROGRESS", arrivedAt: NOW.toISOString(), startedAt: NOW.toISOString() });
    const event = fx.audit.events.at(-1);
    expect(event).toMatchObject({ action: "CLINIC_APPOINTMENT_START", actorType: "CLINIC_ACCOUNT", actorClinicAccountId: "acc-a", resourceType: "Appointment", resourceId: "apt-1" });
    expect(event?.familyId).toBeUndefined();
    expect(event?.subjectMemberId).toBeUndefined();
    expect(JSON.stringify(fx.audit.events)).not.toContain("Maria");
  });

  it("Faltou: SCHEDULED passada sem início => NO_SHOW; depois Chegou volta a SCHEDULED com chegada; o horário não é reaberto", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt({ scheduledAt: new Date("2026-11-08T11:00:00.000Z") }));
    const noShow = createNoShowClinicAppointmentUseCase(fx.deps);
    const view = await noShow(ACTOR, "apt-1", CTX);
    expect(view).toMatchObject({ status: "NO_SHOW", dayState: "NO_SHOW" });
    await noShow(ACTOR, "apt-1", CTX);
    expect(fx.audit.events.filter((e) => e.action === "CLINIC_APPOINTMENT_NO_SHOW")).toHaveLength(1);
    expect(await fx.appointmentsRepo.findActiveBySlot({}, "slot-1")).toBeNull();

    const late = await createArriveClinicAppointmentUseCase(fx.deps)(ACTOR, "apt-1", CTX);
    expect(late).toMatchObject({ status: "SCHEDULED", dayState: "ARRIVED", arrivedAt: NOW.toISOString() });
  });

  it("Faltou antes da hora, após Iniciar ou em CANCELLED; Chegou/Iniciar fora do dia => INVALID_STATE_TRANSITION", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt({ id: "future", scheduledAt: new Date("2026-11-08T15:00:00.000Z") }));
    fx.appointmentsRepo.seed(appt({ id: "started", scheduledAt: new Date("2026-11-08T11:00:00.000Z"), arrivedAt: NOW, startedAt: NOW }));
    fx.appointmentsRepo.seed(appt({ id: "cancelled", scheduledAt: new Date("2026-11-08T11:00:00.000Z"), status: "CANCELLED" }));
    fx.appointmentsRepo.seed(appt({ id: "tomorrow", scheduledAt: new Date("2026-11-09T09:00:00.000Z") }));
    const noShow = createNoShowClinicAppointmentUseCase(fx.deps);
    for (const id of ["future", "started", "cancelled"]) {
      await expect(noShow(ACTOR, id, CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    }
    await expect(createArriveClinicAppointmentUseCase(fx.deps)(ACTOR, "tomorrow", CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(createStartClinicAppointmentUseCase(fx.deps)(ACTOR, "tomorrow", CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(createConfirmClinicAppointmentByPhoneUseCase(fx.deps)(ACTOR, "cancelled", CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("Concluir continua igual: aceita SCHEDULED com ou sem chegada/início e mantém o resultado", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt({ scheduledAt: new Date("2026-11-08T11:00:00.000Z"), arrivedAt: NOW, startedAt: NOW }));
    const done = await createCompleteClinicAppointmentUseCase(fx.deps)(ACTOR, "apt-1", { outcomeNote: "Tudo bem." }, CTX);
    expect(done).toMatchObject({ status: "COMPLETED", dayState: "COMPLETED", arrivedAt: NOW.toISOString() });
    expect((await fx.appointmentsRepo.findByClinicId({}, CLINIC, "apt-1"))?.clinicOutcomeNote).toBe("Tudo bem.");
  });

  it("outra clínica / id inexistente => NOT_FOUND em todas as ações (sem enumeração)", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt({ scheduledAt: new Date("2026-11-08T15:00:00.000Z") }));
    const calls = [
      createConfirmClinicAppointmentByPhoneUseCase(fx.deps)(OTHER_ACTOR, "apt-1", CTX),
      createArriveClinicAppointmentUseCase(fx.deps)(OTHER_ACTOR, "apt-1", CTX),
      createStartClinicAppointmentUseCase(fx.deps)(OTHER_ACTOR, "apt-1", CTX),
      createNoShowClinicAppointmentUseCase(fx.deps)(OTHER_ACTOR, "apt-1", CTX),
      createSetClinicFollowUpUseCase(fx.deps)(OTHER_ACTOR, "apt-1", { amount: 1, unit: "WEEKS" }, CTX),
      createClearClinicFollowUpUseCase(fx.deps)(OTHER_ACTOR, "apt-1", CTX),
    ];
    for (const call of calls) await expect(call).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await fx.appointmentsRepo.findByClinicId({}, CLINIC, "apt-1"))?.arrivedAt).toBeUndefined();
  });

  it("visita manual: o id de uma visita é despachado para a porta de visitas (e a consulta Vita nunca é tocada)", async () => {
    const { fx } = setup();
    fx.clinics.seedSlot({ id: "slot-v", clinicId: CLINIC, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: new Date("2026-11-08T15:00:00.000Z"), durationMinutes: 30, capacity: 1 });
    fx.clinicPatients.seedPatient("cp-1", CLINIC, "Zé Manuel");
    const visit = await fx.clinicPatients.bookVisit({}, ACTOR, { clinicPatientId: "cp-1", slotId: "slot-v" });
    await createConfirmClinicAppointmentByPhoneUseCase(fx.deps)(ACTOR, visit.id, CTX);
    await createArriveClinicAppointmentUseCase(fx.deps)(ACTOR, visit.id, CTX);
    await createStartClinicAppointmentUseCase(fx.deps)(ACTOR, visit.id, CTX);
    await createNoShowClinicAppointmentUseCase(fx.deps)(ACTOR, visit.id, CTX);
    await createSetClinicFollowUpUseCase(fx.deps)(ACTOR, visit.id, { amount: 1, unit: "MONTHS" }, CTX);
    await createClearClinicFollowUpUseCase(fx.deps)(ACTOR, visit.id, CTX);
    expect(fx.clinicPatients.calls).toEqual(["bookVisit", "confirmVisit", "arriveVisit", "startVisit", "noShowVisit", "setVisitFollowUp", "clearVisitFollowUp"]);
    await expect(createArriveClinicAppointmentUseCase(fx.deps)(OTHER_ACTOR, visit.id, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("retorno (AC-CLN-24, BR-CLN-30)", () => {
  it("PUT calcula o dia local + N semanas/meses, substitui o anterior e DELETE limpa (idempotente); auditoria só com amount/unit", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt({ status: "COMPLETED", scheduledAt: new Date("2026-01-31T10:00:00.000Z") }));
    const set = createSetClinicFollowUpUseCase(fx.deps);
    expect((await set(ACTOR, "apt-1", { amount: 1, unit: "MONTHS" }, CTX)).followUpDueOn).toBe("2026-02-28");
    expect((await set(ACTOR, "apt-1", { amount: 2, unit: "WEEKS" }, CTX)).followUpDueOn).toBe("2026-02-14");
    const event = fx.audit.events.filter((e) => e.action === "CLINIC_FOLLOWUP_SET").at(-1);
    expect(event?.metadata).toEqual({ amount: 2, unit: "WEEKS" });
    const clear = createClearClinicFollowUpUseCase(fx.deps);
    expect((await clear(ACTOR, "apt-1", CTX)).followUpDueOn).toBeUndefined();
    await clear(ACTOR, "apt-1", CTX);
    expect(fx.audit.events.filter((e) => e.action === "CLINIC_FOLLOWUP_CLEAR")).toHaveLength(1);
  });

  it("quantidade fora de 1..24 => VALIDATION_ERROR; não COMPLETED => INVALID_STATE_TRANSITION", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt({ id: "done", status: "COMPLETED", scheduledAt: new Date("2026-11-01T10:00:00.000Z") }));
    fx.appointmentsRepo.seed(appt({ id: "open" }));
    const set = createSetClinicFollowUpUseCase(fx.deps);
    await expect(set(ACTOR, "done", { amount: 0, unit: "WEEKS" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(set(ACTOR, "done", { amount: 25, unit: "WEEKS" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(set(ACTOR, "open", { amount: 2, unit: "WEEKS" }, CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("sair de COMPLETED (correção do titular, ST4) limpa o retorno", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt({ status: "COMPLETED", scheduledAt: new Date("2026-11-01T10:00:00.000Z"), followUpDueOn: "2026-11-15" }));
    const corrected = await createSetAppointmentStatusUseCase(fx.deps)(USER, FAMILY, MEMBER, "apt-1", { status: "NO_SHOW" }, CTX);
    expect(corrected.followUpDueOn).toBeUndefined();
  });

  it("a agenda da clínica mostra a consulta CANCELLED/DECLINED com o estado e o horário livre (BR-CLN-23 emendada)", async () => {
    const { fx } = setup();
    fx.appointmentsRepo.seed(appt());
    await createSetAppointmentConfirmationUseCase(fx.deps)(USER, FAMILY, MEMBER, "apt-1", { response: "CANNOT" }, CTX);
    const [row] = await createListClinicAgendaUseCase(fx.deps)(ACTOR, {});
    expect(row).toMatchObject({ status: "CANCELLED", confirmationStatus: "DECLINED", dayState: "CANCELLED" });
  });

  it("walk-in nasce PENDING sem chegada (a clínica confirma por telefone no ecrã Hoje)", async () => {
    const { fx } = setup();
    fx.clinics.seedSlot({ id: "slot-w", clinicId: CLINIC, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: new Date("2026-11-09T09:00:00.000Z"), durationMinutes: 30, capacity: 1 });
    fx.patients.seed("m@example.pt", FAMILY, MEMBER, "Maria Santos Silva");
    const view = await createCreateWalkInAppointmentUseCase(fx.deps)(ACTOR, { patientEmail: "m@example.pt", slotId: "slot-w", notes: null }, CTX);
    expect(view).toMatchObject({ confirmationStatus: "PENDING", dayState: "SCHEDULED" });
  });
});
