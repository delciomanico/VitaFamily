// TC-CLN-13/15/16 (AC-CLN-22/23/24) do lado das visitas manuais, indicadores, retornos e calendário (fakes em memória, sem I/O).
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { ClinicVisit } from "../domain/clinic-visit.js";
import { createGetClinicCalendarUseCase } from "./calendar.js";
import { createClinicPatientsFixtures } from "./fixtures.js";
import { createGetClinicPatientRecordUseCase } from "./record.js";
import { createGetClinicReportSummaryUseCase, createListClinicFollowUpsUseCase } from "./reports.js";
import { createArriveVisitUseCase, createClearVisitFollowUpUseCase, createConfirmVisitUseCase, createNoShowVisitUseCase, createSetVisitFollowUpUseCase, createStartVisitUseCase } from "./visit-day-flow.js";
import { createBookVisitUseCase, createCompleteVisitUseCase, createListVisitsUseCase } from "./visits.js";

const NOW = new Date("2026-11-08T12:00:00.000Z");
const CLINIC = "clinic-a";
const ACTOR = { clinicAccountId: "acc-a", clinicId: CLINIC };
const OTHER_ACTOR = { clinicAccountId: "acc-b", clinicId: "clinic-b" };
const CTX = { requestId: "req-1" };
const at = (iso: string) => new Date(iso);

function setup() {
  const clock = new FixedClock(NOW);
  const fx = createClinicPatientsFixtures(clock);
  fx.members.names.set("mem-1", "Maria Santos Silva");
  const d = fx.deps;
  const slot = (id: string, startsAt: string, extra: Partial<Parameters<typeof fx.slots.seed>[0]> = {}) => { fx.slots.seed({ id, clinicId: CLINIC, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: at(startsAt), durationMinutes: 30, capacity: 1, ...extra }); };
  const visit = (id: string, overrides: Partial<ClinicVisit> = {}): ClinicVisit => {
    const v: ClinicVisit = { id, clinicId: CLINIC, clinicPatientId: "cp-1", scheduledAt: at("2026-11-08T15:00:00.000Z"), durationMinutes: 30, status: "SCHEDULED", confirmationStatus: "PENDING", createdAt: at("2026-11-01T00:00:00.000Z"), ...overrides };
    fx.visitsRepo.byId.set(id, v);
    return v;
  };
  fx.patientsRepo.byId.set("cp-1", { id: "cp-1", clinicId: CLINIC, name: "Zé Manuel", phone: "912345678", origin: "MANUAL", createdAt: at("2026-11-02T10:00:00.000Z"), updatedAt: at("2026-11-02T10:00:00.000Z") });
  return {
    clock, fx, slot, visit,
    confirm: createConfirmVisitUseCase(d), arrive: createArriveVisitUseCase(d), start: createStartVisitUseCase(d), noShow: createNoShowVisitUseCase(d),
    setFollowUp: createSetVisitFollowUpUseCase(d), clearFollowUp: createClearVisitFollowUpUseCase(d),
    book: createBookVisitUseCase(d), complete: createCompleteVisitUseCase(d), listVisits: createListVisitsUseCase(d),
    summary: createGetClinicReportSummaryUseCase(d), followUps: createListClinicFollowUpsUseCase(d), calendar: createGetClinicCalendarUseCase(d), record: createGetClinicPatientRecordUseCase(d),
  };
}

describe("visitas: fluxo do dia (AC-CLN-22)", () => {
  it("confirm, arrive, start com view derivada; repetir não muda o primeiro instante; auditoria CLINIC_VISIT_* sem PII", async () => {
    const s = setup();
    s.visit("v1");
    const confirmed = await s.confirm({}, ACTOR, "v1", CTX);
    expect(confirmed).toMatchObject({ confirmationStatus: "CONFIRMED", confirmationSource: "CLINIC", source: "MANUAL", dayState: "SCHEDULED" });
    await s.confirm({}, ACTOR, "v1", CTX);

    const arrived = await s.arrive({}, ACTOR, "v1", CTX);
    expect(arrived).toMatchObject({ status: "SCHEDULED", dayState: "ARRIVED", arrivedAt: NOW.toISOString(), waitingMinutes: 0 });
    s.clock.advance(5 * 60_000);
    expect((await s.arrive({}, ACTOR, "v1", CTX))?.arrivedAt).toBe(NOW.toISOString());
    const started = await s.start({}, ACTOR, "v1", CTX);
    expect(started).toMatchObject({ dayState: "IN_PROGRESS", waitingMinutes: 5, status: "SCHEDULED" });

    const actions = s.fx.audit.events.map((e) => e.action);
    expect(actions).toEqual(["CLINIC_VISIT_CONFIRM", "CLINIC_VISIT_ARRIVE", "CLINIC_VISIT_START"]);
    expect(s.fx.audit.events.every((e) => e.actorType === "CLINIC_ACCOUNT" && e.familyId === undefined && e.resourceType === "ClinicVisit")).toBe(true);
    expect(JSON.stringify(s.fx.audit.events)).not.toContain("Zé");
  });

  it("Faltou => NO_SHOW (não reabre nem ocupa o horário); Chegou tardia volta a SCHEDULED; completar mantém o fluxo existente", async () => {
    const s = setup();
    s.visit("v1", { scheduledAt: at("2026-11-08T11:00:00.000Z"), slotId: "slot-1" });
    const noShow = await s.noShow({}, ACTOR, "v1", CTX);
    expect(noShow).toMatchObject({ status: "NO_SHOW", dayState: "NO_SHOW" });
    expect(await s.fx.visitsRepo.countScheduledBySlot({}, ["slot-1"])).toEqual([]);
    const late = await s.arrive({}, ACTOR, "v1", CTX);
    expect(late).toMatchObject({ status: "SCHEDULED", dayState: "ARRIVED" });
    const done = await s.complete({}, ACTOR, "v1", { outcomeNote: "ok" }, CTX);
    expect(done).toMatchObject({ status: "COMPLETED", dayState: "COMPLETED" });
  });

  it("transições inválidas => INVALID_STATE_TRANSITION; outra clínica => null (404 no chamador)", async () => {
    const s = setup();
    s.visit("future");
    s.visit("past", { scheduledAt: at("2026-11-08T11:00:00.000Z"), status: "CANCELLED" });
    s.visit("tomorrow", { scheduledAt: at("2026-11-09T09:00:00.000Z") });
    await expect(s.noShow({}, ACTOR, "future", CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(s.noShow({}, ACTOR, "past", CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(s.confirm({}, ACTOR, "past", CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(s.arrive({}, ACTOR, "tomorrow", CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(s.start({}, ACTOR, "tomorrow", CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    for (const action of [s.confirm, s.arrive, s.start, s.noShow, s.clearFollowUp]) {
      expect(await action({}, OTHER_ACTOR, "future", CTX)).toBeNull();
    }
    expect(await s.setFollowUp({}, OTHER_ACTOR, "future", { amount: 1, unit: "WEEKS" }, CTX)).toBeNull();
    expect(s.fx.visitsRepo.byId.get("future")?.arrivedAt).toBeUndefined();
  });

  it("retorno da visita: PUT calcula, substitui; DELETE limpa; só COMPLETED; sair de COMPLETED não existe (final)", async () => {
    const s = setup();
    s.visit("done", { status: "COMPLETED", scheduledAt: at("2026-08-31T10:00:00.000Z") });
    s.visit("open");
    expect((await s.setFollowUp({}, ACTOR, "done", { amount: 6, unit: "MONTHS" }, CTX))?.followUpDueOn).toBe("2027-02-28");
    expect((await s.setFollowUp({}, ACTOR, "done", { amount: 2, unit: "WEEKS" }, CTX))?.followUpDueOn).toBe("2026-09-14");
    expect(s.fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_FOLLOWUP_SET", metadata: { amount: 2, unit: "WEEKS" } });
    expect((await s.clearFollowUp({}, ACTOR, "done", CTX))?.followUpDueOn).toBeUndefined();
    await s.clearFollowUp({}, ACTOR, "done", CTX);
    expect(s.fx.audit.events.filter((e) => e.action === "CLINIC_FOLLOWUP_CLEAR")).toHaveLength(1);
    await expect(s.setFollowUp({}, ACTOR, "open", { amount: 2, unit: "WEEKS" }, CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(s.setFollowUp({}, ACTOR, "done", { amount: 0, unit: "WEEKS" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("calendário e ficha com o fluxo do dia (BR-CLN-23 emendada)", () => {
  it("inclui consultas CANCELLED+DECLINED, visitas NO_SHOW e os campos de estado; exclui CANCELLED normais e REJECTED", async () => {
    const s = setup();
    const base = { durationMinutes: 30, familyId: "fam-1", memberId: "mem-1" };
    s.fx.calendar.appointments = [
      { id: "declined", status: "CANCELLED", startsAt: at("2026-11-09T09:00:00.000Z"), confirmationStatus: "DECLINED", ...base },
      { id: "cancelled", status: "CANCELLED", startsAt: at("2026-11-09T10:00:00.000Z"), confirmationStatus: "CONFIRMED", ...base },
      { id: "rejected", status: "REJECTED", startsAt: at("2026-11-09T11:00:00.000Z"), confirmationStatus: "PENDING", ...base },
      { id: "arrived", status: "SCHEDULED", startsAt: at("2026-11-08T14:00:00.000Z"), confirmationStatus: "CONFIRMED", arrivedAt: at("2026-11-08T11:50:00.000Z"), ...base },
    ];
    s.visit("v-noshow", { status: "NO_SHOW", scheduledAt: at("2026-11-08T09:00:00.000Z") });
    const view = await s.calendar(ACTOR, { from: "2026-11-08T00:00:00.000Z", to: "2026-11-10T00:00:00.000Z" });
    expect(view.entries.map((e) => e.id)).toEqual(["v-noshow", "arrived", "declined"]);
    expect(view.entries.find((e) => e.id === "declined")).toMatchObject({ status: "CANCELLED", confirmationStatus: "DECLINED", dayState: "CANCELLED" });
    expect(view.entries.find((e) => e.id === "arrived")).toMatchObject({ dayState: "ARRIVED", waitingMinutes: 10, arrivedAt: at("2026-11-08T11:50:00.000Z") });
    expect(view.entries.find((e) => e.id === "v-noshow")).toMatchObject({ source: "MANUAL", dayState: "NO_SHOW", confirmationStatus: "PENDING" });
  });

  it("a ficha mostra o estado de confirmação/dia das marcações Vita e das visitas", async () => {
    const s = setup();
    s.fx.linksRepo.links.push({ clinicId: CLINIC, clinicPatientId: "cp-1", familyId: "fam-1", memberId: "mem-1", via: "CODE" });
    s.fx.calendar.appointments = [{ id: "a1", status: "SCHEDULED", startsAt: at("2026-11-08T14:00:00.000Z"), confirmationStatus: "CONFIRMED", durationMinutes: 30, familyId: "fam-1", memberId: "mem-1" }];
    s.visit("v1");
    const record = await s.record(ACTOR, "cp-1");
    expect(record.bookings.find((b) => b.id === "a1")).toMatchObject({ source: "VITA", confirmationStatus: "CONFIRMED", dayState: "SCHEDULED" });
    expect(record.bookings.find((b) => b.id === "v1")).toMatchObject({ source: "MANUAL", confirmationStatus: "PENDING", dayState: "SCHEDULED" });
  });
});

describe("getClinicReportSummary (AC-CLN-23)", () => {
  function fixture() {
    const s = setup();
    s.fx.slots.professionals.set("p1", { id: "p1", clinicId: CLINIC, name: "Dr. Ana" });
    s.fx.slots.professionals.set("p2", { id: "p2", clinicId: CLINIC, name: "Dr. Bruno" });
    s.fx.slots.professionals.set("px", { id: "px", clinicId: "clinic-b", name: "Dr. Outra" });
    s.slot("s1", "2026-11-02T09:00:00.000Z", { professionalId: "p1", professionalName: "Dr. Ana" });
    s.slot("s2", "2026-11-03T09:00:00.000Z", { professionalId: "p1", professionalName: "Dr. Ana", kind: "EXAM", capacity: 2, specialty: "Ecografia" });
    s.slot("s3", "2026-11-04T09:00:00.000Z", { professionalId: "p2", professionalName: "Dr. Bruno" });
    s.slot("s4", "2026-11-05T09:00:00.000Z");
    s.slot("s5", "2026-11-06T09:00:00.000Z", { professionalId: "p2", professionalName: "Dr. Bruno" });
    s.slot("s-out", "2026-11-09T09:00:00.000Z", { professionalId: "p1", professionalName: "Dr. Ana" });
    const base = { durationMinutes: 30, familyId: "fam-1", memberId: "mem-1", confirmationStatus: "PENDING" as const };
    s.fx.calendar.appointments = [
      { id: "a1", status: "COMPLETED", startsAt: at("2026-11-02T09:00:00.000Z"), slotId: "s1", ...base },
      { id: "a2", status: "NO_SHOW", startsAt: at("2026-11-04T09:00:00.000Z"), slotId: "s3", ...base },
      { id: "a3", status: "CANCELLED", startsAt: at("2026-11-05T09:00:00.000Z"), slotId: "s4", ...base, confirmationStatus: "DECLINED" },
      { id: "a4", status: "COMPLETED", startsAt: at("2026-11-05T15:00:00.000Z"), ...base },
      { id: "a5", status: "REJECTED", startsAt: at("2026-11-06T09:00:00.000Z"), slotId: "s5", ...base },
      { id: "a6", status: "SCHEDULED", startsAt: at("2026-11-06T09:00:00.000Z"), slotId: "s5", ...base },
    ];
    s.fx.calendar.examinations = [
      { id: "e1", status: "COMPLETED", startsAt: at("2026-11-03T09:00:00.000Z"), slotId: "s2", familyId: "fam-1", memberId: "mem-1", resultsCount: 0 },
      { id: "e2", status: "SCHEDULED", startsAt: at("2026-11-03T09:00:00.000Z"), slotId: "s2", familyId: "fam-1", memberId: "mem-1", resultsCount: 0 },
    ];
    s.visit("v1", { status: "COMPLETED", scheduledAt: at("2026-11-02T09:00:00.000Z"), slotId: "s1" });
    s.visit("v2", { status: "CANCELLED", scheduledAt: at("2026-11-05T09:00:00.000Z"), slotId: "s4" });
    s.fx.patientsRepo.byId.set("cp-new", { id: "cp-new", clinicId: CLINIC, name: "Nova Pessoa", origin: "MANUAL", createdAt: at("2026-11-04T10:00:00.000Z"), updatedAt: at("2026-11-04T10:00:00.000Z") });
    return s;
  }
  const query = { from: "2026-11-01", to: "2026-11-08" };

  it("contagens e taxas coincidem com a contagem manual; byProfessional ordenado com 'sem profissional' no fim", async () => {
    const s = fixture();
    const result = await s.summary(ACTOR, query);
    expect(result.from).toBe("2026-11-01");
    expect(result.totals).toEqual({ slotsTotal: 6, slotsBooked: 5, occupancyRate: 5 / 6, completed: 3, noShows: 1, noShowRate: 1 / 4, cancellations: 2, declinedByPatient: 1, newPatients: 2, examsCompleted: 1 });
    expect(result.byProfessional.map((r) => [r.professionalId, r.professionalName])).toEqual([["p1", "Dr. Ana"], ["p2", "Dr. Bruno"], [null, null]]);
    expect(result.byProfessional[0]).toMatchObject({ slotsTotal: 3, slotsBooked: 3, completed: 2 });
  });

  it("com professionalId só essa linha; newPatients não filtra; profissional de outra clínica => NOT_FOUND", async () => {
    const s = fixture();
    const result = await s.summary(ACTOR, { ...query, professionalId: "p2" });
    expect(result.byProfessional).toHaveLength(1);
    expect(result.byProfessional[0]).toMatchObject({ professionalId: "p2", noShows: 1, slotsTotal: 2 });
    expect(result.totals.newPatients).toBe(2);
    await expect(s.summary(ACTOR, { ...query, professionalId: "px" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("janela inválida => VALIDATION_ERROR; sem horários => occupancyRate nulo", async () => {
    const s = fixture();
    await expect(s.summary(ACTOR, { from: "2026-11-08", to: "2026-11-01" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(s.summary(ACTOR, { from: "2025-01-01", to: "2026-11-01" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const empty = await s.summary(ACTOR, { from: "2026-01-01", to: "2026-01-02" });
    expect(empty.totals).toMatchObject({ slotsTotal: 0, occupancyRate: null, noShowRate: null, newPatients: 0 });
  });

  it("outra clínica nunca conta (horários e marcações são da própria clínica)", async () => {
    const s = fixture();
    const result = await s.summary(OTHER_ACTOR, query);
    expect(result.totals.slotsTotal).toBe(0);
  });

  it("limite de 30 pedidos/min por conta: o 31.º => RATE_LIMITED (outra conta não é afetada); repõe-se passado 1 min", async () => {
    const s = fixture();
    for (let i = 0; i < 30; i++) await s.summary(ACTOR, query);
    await expect(s.summary(ACTOR, query)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(s.summary({ clinicAccountId: "acc-other", clinicId: CLINIC }, query)).resolves.toBeDefined();
    s.clock.advance(61_000);
    await expect(s.summary(ACTOR, query)).resolves.toBeDefined();
  });

  it("resposta sem PII: nenhum nome, id de membro/família nem texto de paciente (varrimento)", async () => {
    const s = fixture();
    const text = JSON.stringify(await s.summary(ACTOR, query));
    for (const forbidden of ["Maria", "Zé", "Nova Pessoa", "mem-1", "fam-1", "cp-1", "cp-new", "912345678"]) expect(text).not.toContain(forbidden);
  });
});

describe("listClinicFollowUps (AC-CLN-24)", () => {
  it("mistura consultas Vita e visitas, por data crescente, com nome/telefone do registo da clínica e patientNotified derivado", async () => {
    const s = setup();
    s.fx.linksRepo.links.push({ clinicId: CLINIC, clinicPatientId: "cp-1", familyId: "fam-1", memberId: "mem-1", via: "CODE" });
    s.fx.calendar.followUps = [
      { id: "a-far", familyId: "fam-1", memberId: "mem-1", dueOn: "2026-11-25" },
      { id: "a-soon", familyId: "fam-1", memberId: "mem-1", dueOn: "2026-11-12" },
    ];
    s.visit("v-due", { status: "COMPLETED", followUpDueOn: "2026-11-10" });
    s.visit("v-later", { status: "COMPLETED", followUpDueOn: "2026-11-30" });
    const list = await s.followUps(ACTOR, undefined);
    expect(list.map((i) => i.bookingId)).toEqual(["v-due", "a-soon"]);
    expect(list[0]).toEqual({ bookingId: "v-due", source: "MANUAL", clinicPatientId: "cp-1", patientName: "Zé Manuel", patientPhone: "912345678", dueOn: "2026-11-10", patientNotified: false });
    expect(list[1]).toMatchObject({ source: "VITA", patientName: "Maria Santos Silva", patientPhone: "912345678", patientNotified: true });
    expect(JSON.stringify(list)).not.toContain("fam-1");
    expect(JSON.stringify(list)).not.toContain("mem-1");
    const wide = await s.followUps(ACTOR, "2026-12-31");
    expect(wide.map((i) => i.bookingId)).toEqual(["v-due", "a-soon", "a-far", "v-later"]);
    expect((await s.followUps(OTHER_ACTOR, "2026-12-31"))).toEqual([]);
  });

  it("until inválido => VALIDATION_ERROR", async () => {
    const s = setup();
    await expect(s.followUps(ACTOR, "amanhã")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });
});
