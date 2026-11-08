// BR-CLN-10 / ADR-024 / UC-CLN-08 / AC-CLN-05/06 (fakes em memória, sem I/O).
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createListClinicAgendaUseCase } from "./clinic-appointments.js";
import { createClinicPatientLookupUseCase, createCreateWalkInAppointmentUseCase } from "./clinic-walk-in.js";
import { createAppointmentsFixtures } from "./fixtures.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const SLOT_AT = new Date("2026-02-01T09:00:00.000Z");
const CTX = { requestId: "req-1", ip: "10.0.0.1" };
const CLINIC = "clinic-a";
const ACTOR = { clinicAccountId: "acc-a", clinicId: CLINIC };
const FAMILY = "fam-1";
const MEMBER = "mem-1";
const EMAIL = "maria.silva@example.pt";
const CANARY = "canario-segredo@example.pt";

function setup() {
  const clock = new FixedClock(NOW);
  const fx = createAppointmentsFixtures(clock);
  fx.clinics.seed(CLINIC, "Clínica Sol", "");
  fx.clinics.seedSlot({ id: "slot-1", clinicId: CLINIC, kind: "APPOINTMENT", specialty: "Cardiologia", professionalName: "Dr. Costa", startsAt: SLOT_AT, durationMinutes: 30, capacity: 1 });
  fx.clinics.seedSlot({ id: "slot-exam", clinicId: CLINIC, kind: "EXAM", specialty: "Ecografia", startsAt: SLOT_AT, durationMinutes: 30, capacity: 2 });
  fx.clinics.seedSlot({ id: "slot-past", clinicId: CLINIC, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: new Date("2026-01-01T09:00:00.000Z"), durationMinutes: 30, capacity: 1 });
  fx.clinics.seedSlot({ id: "slot-other", clinicId: "clinic-b", kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: SLOT_AT, durationMinutes: 30, capacity: 1 });
  fx.patients.seed(EMAIL, FAMILY, MEMBER, "Maria Santos Silva");
  fx.memberNames.seed(FAMILY, MEMBER, "Maria Santos Silva");
  return { clock, fx, lookup: createClinicPatientLookupUseCase(fx.deps), book: createCreateWalkInAppointmentUseCase(fx.deps) };
}

describe("clinicPatientLookup", () => {
  it("devolve só displayName; e-mail normalizado; auditoria SUCCESS sem PII", async () => {
    const { fx, lookup } = setup();
    const result = await lookup(ACTOR, { email: "  Maria.SILVA@example.pt " }, CTX);
    expect(result).toEqual({ displayName: "Maria S." });
    expect(fx.patients.lookedUp).toEqual([EMAIL]);
    const event = fx.audit.events.at(-1);
    expect(event).toMatchObject({ action: "CLINIC_WALKIN_LOOKUP", actorType: "CLINIC_ACCOUNT", actorClinicAccountId: "acc-a", result: "SUCCESS", familyId: FAMILY, subjectMemberId: MEMBER });
    expect(JSON.stringify(fx.audit.events)).not.toContain("maria");
    expect(JSON.stringify(fx.audit.events)).not.toContain("Maria");
  });

  it("404 genérico idêntico para qualquer paciente não resolvível; FAILURE sem sujeito e sem e-mail", async () => {
    const { fx, lookup } = setup();
    const err = await lookup(ACTOR, { email: CANARY }, CTX).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "NOT_FOUND", detail: "Utilizador não encontrado." });
    const event = fx.audit.events.at(-1);
    expect(event).toMatchObject({ action: "CLINIC_WALKIN_LOOKUP", result: "FAILURE" });
    expect(event?.familyId).toBeUndefined();
    expect(event?.subjectMemberId).toBeUndefined();
    expect(JSON.stringify(fx.audit.events)).not.toContain("canario");
  });

  it("e-mail inválido => VALIDATION_ERROR", async () => {
    const { lookup } = setup();
    await expect(lookup(ACTOR, { email: "nao-e-email" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rate limit por conta: 30/h (a 31.ª => RATE_LIMITED + DENIED com reason)", async () => {
    const { fx, lookup } = setup();
    for (let i = 0; i < 30; i += 1) {
      // IPs distintos: isola o limite da conta do limite por IP.
      await lookup(ACTOR, { email: EMAIL }, { requestId: "r", ip: `10.0.1.${String(i)}` });
    }
    const err = await lookup(ACTOR, { email: EMAIL }, { requestId: "r", ip: "10.0.2.1" }).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "RATE_LIMITED" });
    expect((err as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0);
    expect(fx.audit.events.at(-1)).toMatchObject({ result: "DENIED", metadata: { reason: "RATE_LIMITED" } });
  });

  it("rate limit por IP: 60/h partilhado por várias contas", async () => {
    const { lookup } = setup();
    for (let i = 0; i < 60; i += 1) {
      await lookup({ clinicAccountId: `acc-${String(i % 3)}`, clinicId: CLINIC }, { email: EMAIL }, CTX);
    }
    await expect(lookup({ clinicAccountId: "acc-9", clinicId: CLINIC }, { email: EMAIL }, CTX)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("10 respostas 404 em 15 min => 11.º pedido RATE_LIMITED (mesmo para e-mail válido); liberta após a janela", async () => {
    const { clock, lookup } = setup();
    for (let i = 0; i < 10; i += 1) {
      await expect(lookup(ACTOR, { email: `x${String(i)}@example.pt` }, { requestId: "r", ip: `10.0.3.${String(i)}` })).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(lookup(ACTOR, { email: EMAIL }, CTX)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    clock.advance(16 * 60 * 1000);
    await expect(lookup(ACTOR, { email: EMAIL }, CTX)).resolves.toEqual({ displayName: "Maria S." });
  });
});

describe("createWalkInAppointment", () => {
  const input = { patientEmail: EMAIL, slotId: "slot-1", notes: "  trazer exames " };

  it("cria SCHEDULED no SELF, ocupa o horário, walk_in, só o mínimo BR-CLN-03; auditoria sem PII", async () => {
    const { fx, book } = setup();
    const view = await book(ACTOR, input, CTX);
    expect(view).toMatchObject({ status: "SCHEDULED", scheduledAt: SLOT_AT.toISOString(), specialty: "Cardiologia", professionalName: "Dr. Costa", patientName: "Maria Santos Silva", notes: "trazer exames" });
    // M14 P: `source`, `clinicPatientId` e `slotId` (BR-CLN-18); continua a não haver nenhum id Vita.
    expect(Object.keys(view).sort()).toEqual(["clinicPatientId", "id", "notes", "patientName", "professionalName", "scheduledAt", "slotId", "source", "specialty", "status"]);
    expect(view).toMatchObject({ source: "VITA", slotId: "slot-1" });
    const stored = [...fx.appointmentsRepo.byId.values()][0];
    expect(stored).toMatchObject({ familyId: FAMILY, memberId: MEMBER, slotId: "slot-1", clinicId: CLINIC, clinicName: "Clínica Sol", walkIn: true, bookedByClinicAccountId: "acc-a", status: "SCHEDULED" });
    expect(await fx.appointmentsRepo.findActiveBySlot({}, "slot-1")).toBeTruthy();
    expect(fx.audit.events.at(-1)).toMatchObject({
      action: "CLINIC_WALKIN_BOOK",
      actorType: "CLINIC_ACCOUNT",
      resourceType: "Appointment",
      resourceId: stored?.id,
      familyId: FAMILY,
      subjectMemberId: MEMBER,
      result: "SUCCESS",
      metadata: { slotId: "slot-1" },
    });
    expect(JSON.stringify(fx.audit.events)).not.toContain(EMAIL);
  });

  it("aparece na agenda da clínica", async () => {
    const { fx, book } = setup();
    await book(ACTOR, input, CTX);
    const agenda = await createListClinicAgendaUseCase(fx.deps)(ACTOR, {});
    expect(agenda).toHaveLength(1);
  });

  it("horário de outra clínica ou inexistente => NOT_FOUND (antes de resolver o paciente)", async () => {
    const { fx, book } = setup();
    await expect(book(ACTOR, { ...input, slotId: "slot-other" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND", detail: "Horário não encontrado." });
    await expect(book(ACTOR, { ...input, slotId: "nope" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fx.patients.lookedUp).toHaveLength(0);
  });

  it("paciente não resolvível => 404 genérico (o mesmo do lookup), sem escrever nada", async () => {
    const { fx, book } = setup();
    await expect(book(ACTOR, { ...input, patientEmail: CANARY }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND", detail: "Utilizador não encontrado." });
    expect(fx.appointmentsRepo.byId.size).toBe(0);
    expect(JSON.stringify(fx.audit.events)).not.toContain("canario");
  });

  it("slot kind=EXAM => VALIDATION_ERROR; passado => CONFLICT; ocupado => CONFLICT", async () => {
    const { fx, book } = setup();
    await expect(book(ACTOR, { ...input, slotId: "slot-exam" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(book(ACTOR, { ...input, slotId: "slot-past" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    await book(ACTOR, input, CTX);
    fx.patients.seed("outro@example.pt", "fam-2", "mem-2", "Outro Utilizador");
    await expect(book(ACTOR, { ...input, patientEmail: "outro@example.pt" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("sobreposição com consulta SCHEDULED do paciente => CONFLICT; REQUESTED/CANCELLED não contam", async () => {
    const { fx, book } = setup();
    const base = { id: "a1", familyId: FAMILY, memberId: MEMBER, scheduledAt: new Date(SLOT_AT.getTime() + 10 * 60_000), status: "SCHEDULED" as const, createdAt: NOW };
    fx.appointmentsRepo.seed({ ...base, status: "CANCELLED" });
    await expect(book(ACTOR, input, CTX)).resolves.toMatchObject({ status: "SCHEDULED" });
    fx.clinics.seedSlot({ id: "slot-2", clinicId: CLINIC, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: SLOT_AT, durationMinutes: 30, capacity: 1 });
    fx.appointmentsRepo.seed({ ...base, id: "a2" });
    await expect(book(ACTOR, { ...input, slotId: "slot-2" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("notes > 2000 => VALIDATION_ERROR; e-mail inválido => VALIDATION_ERROR", async () => {
    const { book } = setup();
    await expect(book(ACTOR, { ...input, notes: "x".repeat(2001) }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(book(ACTOR, { ...input, patientEmail: "x" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rate limit partilhado com o lookup (30/h por conta); DENIED auditado", async () => {
    const { fx, lookup, book } = setup();
    for (let i = 0; i < 30; i += 1) {
      await lookup(ACTOR, { email: EMAIL }, { requestId: "r", ip: `10.0.1.${String(i)}` });
    }
    await expect(book(ACTOR, input, { requestId: "r", ip: "10.9.9.9" })).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_WALKIN_BOOK", result: "DENIED", metadata: { reason: "RATE_LIMITED" } });
    expect(fx.appointmentsRepo.byId.size).toBe(0);
  });
});
