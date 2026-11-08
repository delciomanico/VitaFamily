// AC-CLN-14/17/18 / TC-CLN-09/12 (A): histórico partilhado, ficha, pesquisa global, calendário, visitas manuais, diretório
// e job de limpeza dos códigos.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { ConflictError, NotFoundError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { createClinicGlobalSearchUseCase, createGetClinicCalendarUseCase } from "./calendar.js";
import { createEnsureLinkedByEmailUseCase, createFindPatientIdsByMembersUseCase, createResolvePatientUseCase } from "./directory.js";
import { createClinicPatientsFixtures } from "./fixtures.js";
import { createCreateClinicPatientUseCase } from "./patients.js";
import { createPurgeLinkCodesJobUseCase } from "./purge-link-codes.js";
import { createGetClinicPatientRecordUseCase } from "./record.js";
import { createGetSharedHistoryUseCase, sharedExamsSince } from "./shared-history.js";
import { createBookVisitUseCase, createCancelVisitUseCase, createCompleteVisitUseCase, createListVisitsUseCase } from "./visits.js";

const NOW = new Date("2026-11-08T10:00:00.000Z");
const CLINIC = "clinic-a";
const ACTOR = { clinicAccountId: "acc-a", clinicId: CLINIC };
const OTHER_ACTOR = { clinicAccountId: "acc-b", clinicId: "clinic-b" };
const FAMILY = "fam-1";
const MEMBER = "mem-1";
const CTX = { requestId: "req-1" };
const at = (iso: string) => new Date(iso);

function setup() {
  const clock = new FixedClock(NOW);
  const fx = createClinicPatientsFixtures(clock);
  fx.members.names.set(MEMBER, "Maria Santos Silva");
  const deps = fx.deps;
  const slot = (id: string, startsAt: string, extra: Partial<Parameters<typeof fx.slots.seed>[0]> = {}) => { fx.slots.seed({ id, clinicId: CLINIC, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: at(startsAt), durationMinutes: 30, capacity: 1, ...extra }); };
  return {
    clock,
    fx,
    slot,
    create: createCreateClinicPatientUseCase(deps),
    history: createGetSharedHistoryUseCase(deps),
    record: createGetClinicPatientRecordUseCase(deps),
    search: createClinicGlobalSearchUseCase(deps),
    calendar: createGetClinicCalendarUseCase(deps),
    book: createBookVisitUseCase(deps),
    listVisits: createListVisitsUseCase(deps),
    cancel: createCancelVisitUseCase(deps),
    complete: createCompleteVisitUseCase(deps),
    resolve: createResolvePatientUseCase(deps),
    ensure: createEnsureLinkedByEmailUseCase(deps),
    byMembers: createFindPatientIdsByMembersUseCase(deps),
    purge: createPurgeLinkCodesJobUseCase(deps),
  };
}

/** Paciente da clínica A ligado ao membro Vita, com o consentimento indicado. */
async function linkedPatient(s: ReturnType<typeof setup>, consent: { level: "BOOKINGS" | "HISTORY"; historyValidUntil?: Date } | null) {
  const patient = await s.create(ACTOR, { name: "Maria Balcão" }, CTX);
  s.fx.linksRepo.links.push({ clinicId: CLINIC, clinicPatientId: patient.id, familyId: FAMILY, memberId: MEMBER, via: "CODE" });
  if (consent) s.fx.consentsRepo.consents.push({ clinicId: CLINIC, familyId: FAMILY, memberId: MEMBER, ...consent });
  return patient;
}

describe("getSharedHistory (BR-CLN-21)", () => {
  const medication = { name: "Metformina", dosage: "850 mg", startAt: at("2026-01-01T08:00:00Z"), endAt: null, continuous: true };
  const exam = { name: "Hemograma", examDate: "2026-10-01", status: "COMPLETED" as const, results: [{ parameter: "Hb", valueNumeric: 7, valueText: null, unit: "g/dL", referenceMin: 12, referenceMax: 16 }] };

  it("com HISTORY válido devolve medicação e exames (valores sem interpretação) e audita sem conteúdo", async () => {
    const s = setup();
    s.fx.sharedHistory.medications = [medication];
    s.fx.sharedHistory.exams = [exam];
    const until = at("2027-06-01T00:00:00Z");
    const patient = await linkedPatient(s, { level: "HISTORY", historyValidUntil: until });
    const result = await s.history(ACTOR, patient.id, CTX);
    expect(result).toEqual({
      active: true,
      level: "HISTORY",
      validUntil: until.toISOString(),
      medications: [{ name: "Metformina", dosage: "850 mg", startAt: "2026-01-01T08:00:00.000Z", endAt: null, continuous: true }],
      examinations: [exam],
    });
    expect(s.fx.sharedHistory.calls).toEqual(["meds", `exams:${sharedExamsSince(NOW)}`]);
    expect(sharedExamsSince(NOW)).toBe("2024-11-08");
    expect(s.fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_SHARED_HISTORY_VIEW", result: "SUCCESS", resourceId: patient.id, familyId: FAMILY, subjectMemberId: MEMBER, metadata: { level: "HISTORY" } });
    expect(JSON.stringify(s.fx.audit.events)).not.toContain("Metformina");
    expect(JSON.stringify(s.fx.audit.events)).not.toContain("Hemograma");
  });

  it.each([
    ["sem ligação", "none"],
    ["sem consentimento", "no-consent"],
    ["só BOOKINGS", "bookings"],
    ["HISTORY expirado", "expired"],
  ])("%s => 200 active=false com listas vazias, sem ler nem auditar", async (_label, mode) => {
    const s = setup();
    s.fx.sharedHistory.medications = [medication];
    s.fx.sharedHistory.exams = [exam];
    let patient;
    if (mode === "none") patient = await s.create(ACTOR, { name: "Manual" }, CTX);
    else if (mode === "no-consent") patient = await linkedPatient(s, null);
    else if (mode === "bookings") patient = await linkedPatient(s, { level: "BOOKINGS" });
    else patient = await linkedPatient(s, { level: "HISTORY", historyValidUntil: new Date(NOW.getTime() - 1) });
    const result = await s.history(ACTOR, patient.id, CTX);
    expect(result).toMatchObject({ active: false, validUntil: null, medications: [], examinations: [] });
    expect(s.fx.sharedHistory.calls).toEqual([]);
    expect(s.fx.audit.events.filter((e) => e.action === "CLINIC_SHARED_HISTORY_VIEW")).toEqual([]);
  });

  it("expiração do consentimento com o relógio injetado: ativo antes, inativo depois", async () => {
    const s = setup();
    const patient = await linkedPatient(s, { level: "HISTORY", historyValidUntil: new Date(NOW.getTime() + 1000) });
    expect((await s.history(ACTOR, patient.id, CTX)).active).toBe(true);
    s.clock.advance(1000);
    expect((await s.history(ACTOR, patient.id, CTX)).active).toBe(false);
  });

  it("paciente de outra clínica => NOT_FOUND", async () => {
    const s = setup();
    const patient = await linkedPatient(s, { level: "HISTORY", historyValidUntil: at("2027-06-01T00:00:00Z") });
    await expect(s.history(OTHER_ACTOR, patient.id, CTX)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("visitas manuais (BR-CLN-18)", () => {
  it("marca, ocupa o horário, cria entradas em agenda/calendário e audita sem notas", async () => {
    const s = setup();
    s.slot("slot-1", "2026-11-10T09:00:00Z", { professionalId: "prof-1", professionalName: "Dra. Lima" });
    const patient = await s.create(ACTOR, { name: "CANARY Cliente" }, CTX);
    const view = await s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "slot-1", notes: "CANARY-NOTA" }, CTX);
    expect(view).toMatchObject({ status: "SCHEDULED", source: "MANUAL", clinicPatientId: patient.id, slotId: "slot-1", specialty: "Cardiologia", professionalName: "Dra. Lima", patientName: "CANARY Cliente", notes: "CANARY-NOTA" });
    expect(s.fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_VISIT_BOOK", resourceType: "ClinicVisit", resourceId: view.id, metadata: { slotId: "slot-1" } });
    const dump = JSON.stringify(s.fx.audit.events).toLowerCase();
    expect(dump).not.toContain("canary");
    await expect(s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "slot-1" }, CTX)).rejects.toBeInstanceOf(ConflictError);
    expect(await s.listVisits({}, CLINIC, {})).toHaveLength(1);
  });

  it("ordem horário → paciente → estado: horário/paciente de outra clínica => NOT_FOUND; exame => 422; passado => CONFLICT", async () => {
    const s = setup();
    s.slot("slot-ok", "2026-11-10T09:00:00Z");
    s.slot("slot-exam", "2026-11-10T10:00:00Z", { kind: "EXAM", capacity: 2 });
    s.slot("slot-past", "2026-11-01T09:00:00Z");
    s.fx.slots.seed({ id: "slot-other", clinicId: "clinic-b", kind: "APPOINTMENT", specialty: "X", startsAt: at("2026-11-10T09:00:00Z"), durationMinutes: 30, capacity: 1 });
    const patient = await s.create(ACTOR, { name: "Ana" }, CTX);
    const foreign = await s.create(OTHER_ACTOR, { name: "Alheio" }, CTX);
    await expect(s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "slot-other" }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.book({}, ACTOR, { clinicPatientId: foreign.id, slotId: "slot-ok" }, CTX)).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "slot-exam" }, CTX)).rejects.toBeInstanceOf(ValidationError);
    await expect(s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "slot-past" }, CTX)).rejects.toBeInstanceOf(ConflictError);
  });

  it("CONFLICT: horário com consulta Vita ativa; sobreposição do paciente (por duração); sobreposição do profissional (consulta, exame ou visita)", async () => {
    const s = setup();
    s.slot("busy", "2026-11-10T09:00:00Z");
    s.fx.slots.occupancy.set("busy", { requested: 0, scheduled: 1 });
    s.slot("a", "2026-11-11T09:00:00Z", { durationMinutes: 60 });
    s.slot("a-overlap", "2026-11-11T09:30:00Z", { professionalId: "p2" });
    s.slot("a-adjacent", "2026-11-11T10:00:00Z");
    const patient = await s.create(ACTOR, { name: "Ana" }, CTX);
    const other = await s.create(ACTOR, { name: "Bia" }, CTX);
    await expect(s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "busy" }, CTX)).rejects.toBeInstanceOf(ConflictError);
    await s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "a" }, CTX);
    await expect(s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "a-overlap" }, CTX)).rejects.toThrow("O paciente já tem uma visita");
    await expect(s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "a-adjacent" }, CTX)).resolves.toBeDefined();

    // profissional: outro horário dele sobreposto já ocupado (consulta Vita, exame e visita)
    s.slot("p-1", "2026-11-12T09:00:00Z", { professionalId: "prof" });
    s.slot("p-2", "2026-11-12T09:15:00Z", { professionalId: "prof" });
    s.fx.slots.occupancy.set("p-1", { requested: 1, scheduled: 0 });
    await expect(s.book({}, ACTOR, { clinicPatientId: other.id, slotId: "p-2" }, CTX)).rejects.toThrow("O profissional já tem uma marcação");
    s.fx.slots.occupancy.delete("p-1");
    await s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "p-1" }, CTX);
    await expect(s.book({}, ACTOR, { clinicPatientId: other.id, slotId: "p-2" }, CTX)).rejects.toThrow("O profissional já tem uma marcação");
  });

  it("cancelar (motivo, futura) liberta o horário; completar só com outcomeNote; receita => 422; id desconhecido/outra clínica => null", async () => {
    const s = setup();
    s.slot("slot-1", "2026-11-10T09:00:00Z");
    s.slot("slot-2", "2026-11-10T11:00:00Z");
    const patient = await s.create(ACTOR, { name: "Ana" }, CTX);
    const v1 = await s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "slot-1" }, CTX);
    const v2 = await s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "slot-2" }, CTX);

    expect(await s.cancel({}, OTHER_ACTOR, v1.id, "x", CTX)).toBeNull();
    const cancelled = await s.cancel({}, ACTOR, v1.id, "Doente", CTX);
    expect(cancelled).toMatchObject({ status: "CANCELLED", responseNote: "Doente" });
    expect(s.fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_VISIT_CANCEL", metadata: { slotId: "slot-1" } });
    expect(JSON.stringify(s.fx.audit.events)).not.toContain("Doente");
    await expect(s.cancel({}, ACTOR, v1.id, "outra vez", CTX)).rejects.toBeInstanceOf(ConflictError);
    // o horário libertou-se
    await expect(s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "slot-1" }, CTX)).resolves.toBeDefined();

    await expect(s.complete({}, ACTOR, v2.id, { outcomeNote: "ok", prescription: { medications: [] } }, CTX)).rejects.toBeInstanceOf(ValidationError);
    const done = await s.complete({}, ACTOR, v2.id, { outcomeNote: "Tudo bem" }, CTX);
    expect(done).toMatchObject({ status: "COMPLETED" });
    expect(s.fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_VISIT_COMPLETE", resourceType: "ClinicVisit" });
    expect(JSON.stringify(s.fx.audit.events)).not.toContain("Tudo bem");
    await expect(s.complete({}, ACTOR, v2.id, {}, CTX)).rejects.toBeInstanceOf(ConflictError);
    expect(await s.complete({}, ACTOR, "desconhecida", {}, CTX)).toBeNull();
  });

  it("não se cancela uma visita já passada", async () => {
    const s = setup();
    s.slot("slot-1", "2026-11-10T09:00:00Z");
    const patient = await s.create(ACTOR, { name: "Ana" }, CTX);
    const visit = await s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "slot-1" }, CTX);
    s.clock.advance(3 * 86_400_000);
    await expect(s.cancel({}, ACTOR, visit.id, "tarde", CTX)).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("diretório (walk-in)", () => {
  it("resolvePatient: ligado, manual e de outra clínica", async () => {
    const s = setup();
    const linked = await linkedPatient(s, { level: "BOOKINGS" });
    const manual = await s.create(ACTOR, { name: "Manual" }, CTX);
    expect(await s.resolve({}, CLINIC, linked.id)).toEqual({ clinicPatientId: linked.id, name: "Maria Balcão", link: { familyId: FAMILY, memberId: MEMBER } });
    expect(await s.resolve({}, CLINIC, manual.id)).toMatchObject({ link: null });
    expect(await s.resolve({}, "clinic-b", linked.id)).toBeNull();
  });

  it("ensureLinkedByEmail cria paciente VITA (displayName) + link EMAIL + BOOKINGS; reutiliza; nunca baixa HISTORY", async () => {
    const s = setup();
    const first = await s.ensure({}, ACTOR, { familyId: FAMILY, memberId: MEMBER, fullName: "Maria Santos Silva" }, CTX);
    expect(s.fx.patientsRepo.byId.get(first.clinicPatientId)).toMatchObject({ name: "Maria S.", origin: "VITA" });
    expect(s.fx.linksRepo.links).toEqual([{ clinicId: CLINIC, clinicPatientId: first.clinicPatientId, familyId: FAMILY, memberId: MEMBER, via: "EMAIL" }]);
    expect(s.fx.consentsRepo.consents).toEqual([{ clinicId: CLINIC, familyId: FAMILY, memberId: MEMBER, level: "BOOKINGS" }]);
    expect(s.fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_PATIENT_LINK", metadata: { via: "EMAIL", created: true } });
    expect(JSON.stringify(s.fx.audit.events)).not.toContain("Maria S.");
    s.fx.consentsRepo.consents[0] = { clinicId: CLINIC, familyId: FAMILY, memberId: MEMBER, level: "HISTORY", historyValidUntil: at("2027-01-01T00:00:00Z") };
    const again = await s.ensure({}, ACTOR, { familyId: FAMILY, memberId: MEMBER, fullName: "Maria Santos Silva" }, CTX);
    expect(again).toEqual(first);
    expect(s.fx.consentsRepo.consents[0].level).toBe("HISTORY");
    expect(s.fx.patientsRepo.byId.size).toBe(1);
  });

  it("findPatientIdsByMembers só da clínica", async () => {
    const s = setup();
    const linked = await linkedPatient(s, null);
    expect((await s.byMembers({}, CLINIC, [MEMBER])).get(MEMBER)).toBe(linked.id);
    expect((await s.byMembers({}, "clinic-b", [MEMBER])).size).toBe(0);
  });
});

describe("calendário (BR-CLN-23)", () => {
  function seedCalendar(s: ReturnType<typeof setup>) {
    s.fx.slots.professionals.set("prof-1", { id: "prof-1", clinicId: CLINIC, name: "Dra. Lima" });
    s.fx.slots.professionals.set("prof-2", { id: "prof-2", clinicId: CLINIC, name: "Dr. Costa" });
    s.slot("s1", "2026-11-10T09:00:00Z", { professionalId: "prof-1", professionalName: "Dra. Lima" });
    s.slot("s2", "2026-11-10T10:00:00Z", { professionalId: "prof-2", professionalName: "Dr. Costa" });
    s.slot("s3", "2026-11-10T11:00:00Z", { professionalId: "prof-1", professionalName: "Dra. Lima" });
    s.slot("sx", "2026-11-10T12:00:00Z", { kind: "EXAM", capacity: 2, specialty: "Ecografia", professionalId: "prof-1", professionalName: "Dra. Lima" });
    s.slot("past", "2026-11-05T09:00:00Z", { professionalId: "prof-1" });
    s.fx.calendar.appointments = [
      { id: "ap-ok", status: "SCHEDULED", startsAt: at("2026-11-10T09:00:00Z"), durationMinutes: 30, specialty: "Cardiologia", professionalName: "Dra. Lima", slotId: "s1", familyId: FAMILY, memberId: MEMBER, confirmationStatus: "PENDING" },
      { id: "ap-rej", status: "REJECTED", startsAt: at("2026-11-10T09:00:00Z"), durationMinutes: 30, slotId: "s1", familyId: FAMILY, memberId: MEMBER, confirmationStatus: "PENDING" },
      { id: "ap-cancelled", status: "CANCELLED", startsAt: at("2026-11-10T09:00:00Z"), durationMinutes: 30, slotId: "s1", familyId: FAMILY, memberId: MEMBER, confirmationStatus: "PENDING" },
      { id: "ap-out", status: "SCHEDULED", startsAt: at("2026-12-25T09:00:00Z"), durationMinutes: 30, familyId: FAMILY, memberId: MEMBER, confirmationStatus: "PENDING" },
    ];
    s.fx.calendar.examinations = [{ id: "ex-1", status: "SCHEDULED", startsAt: at("2026-11-10T12:00:00Z"), examType: "Ecografia", slotId: "sx", familyId: FAMILY, memberId: MEMBER, resultsCount: 0 }];
    s.fx.slots.occupancy.set("s1", { requested: 0, scheduled: 1 });
    s.fx.slots.occupancy.set("sx", { requested: 0, scheduled: 1 });
  }
  const win = { from: "2026-11-09T00:00:00.000Z", to: "2026-11-12T00:00:00.000Z" };

  it("entries: consultas REQUESTED/SCHEDULED/COMPLETED/NO_SHOW, exames por exame com endsAt do horário e visitas; freeSlots futuros com vaga", async () => {
    const s = setup();
    seedCalendar(s);
    const patient = await s.create(ACTOR, { name: "Cliente Balcão" }, CTX);
    await s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "s2" }, CTX);
    const result = await s.calendar(ACTOR, win);
    expect(result.entries.map((e) => [e.id === "ap-ok" ? "ap-ok" : e.kind === "EXAM" ? "exam" : e.source === "MANUAL" ? "visit" : e.id, e.startsAt.toISOString().slice(11, 16)])).toEqual([
      ["ap-ok", "09:00"],
      ["visit", "10:00"],
      ["exam", "12:00"],
    ]);
    const exam = result.entries.find((e) => e.kind === "EXAM");
    expect(exam).toMatchObject({ source: "VITA", status: "SCHEDULED", endsAt: at("2026-11-10T12:30:00Z"), professionalId: "prof-1", patientName: "Maria Santos Silva", specialty: "Ecografia", slotId: "sx" });
    const visit = result.entries.find((e) => e.source === "MANUAL");
    expect(visit).toMatchObject({ kind: "APPOINTMENT", professionalId: "prof-2", patientName: "Cliente Balcão", clinicPatientId: patient.id, endsAt: at("2026-11-10T10:30:00Z") });
    // s1 ocupado por consulta, s2 por visita; s3 livre; sx exame com 1 de 2 vagas; "past" passado
    expect(result.freeSlots.map((f) => [f.slotId, f.remaining])).toEqual([["s3", 1], ["sx", 1]]);
  });

  it("filtra por profissional; profissional de outra clínica/inexistente => NOT_FOUND; janela inválida => 422", async () => {
    const s = setup();
    seedCalendar(s);
    s.fx.slots.professionals.set("prof-x", { id: "prof-x", clinicId: "clinic-b", name: "Alheio" });
    const only = await s.calendar(ACTOR, { ...win, professionalId: "prof-1" });
    expect(only.entries.every((e) => e.professionalId === "prof-1")).toBe(true);
    expect(only.freeSlots.every((f) => f.professionalId === "prof-1")).toBe(true);
    await expect(s.calendar(ACTOR, { ...win, professionalId: "prof-x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.calendar(ACTOR, { ...win, professionalId: "nao-existe" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.calendar(ACTOR, { from: win.to, to: win.from })).rejects.toBeInstanceOf(ValidationError);
    await expect(s.calendar(ACTOR, { from: "2026-11-01T00:00:00Z", to: "2026-12-05T00:00:00Z" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("pesquisa global (BR-CLN-22) e ficha", () => {
  it("≤10 pacientes e ≤10 marcações da clínica, futuras primeiro; por nome do paciente, serviço ou profissional; sem a base Vita", async () => {
    const s = setup();
    s.slot("s1", "2026-11-20T09:00:00Z", { professionalId: "prof-1", professionalName: "Dra. Lima" });
    for (let i = 0; i < 12; i++) await s.create(ACTOR, { name: `Maria Teste ${String(i).padStart(2, "0")}` }, CTX);
    await s.create(OTHER_ACTOR, { name: "Maria Outra Clínica" }, CTX);
    const manual = (await s.fx.patientsRepo.list({}, CLINIC, {}, 1))[0];
    if (!manual) throw new Error("sem paciente");
    s.fx.calendar.appointments = Array.from({ length: 12 }, (_, i) => ({
      id: `ap-${String(i)}`,
      status: "SCHEDULED" as const,
      startsAt: new Date(NOW.getTime() + (i % 2 === 0 ? 1 : -1) * (i + 1) * 3_600_000),
      durationMinutes: 30,
      specialty: "Cardiologia",
      familyId: FAMILY,
      memberId: MEMBER,
      confirmationStatus: "PENDING" as const,
    }));
    const result = await s.search(ACTOR, "maria");
    expect(result.patients).toHaveLength(10);
    expect(result.patients.every((p) => p.name.startsWith("Maria Teste"))).toBe(true);
    expect(result.bookings).toHaveLength(10);
    const starts = result.bookings.map((b) => b.startsAt.getTime());
    const future = starts.filter((t) => t >= NOW.getTime());
    expect(starts.slice(0, future.length)).toEqual([...future].sort((a, b) => a - b));
    expect(starts.slice(future.length)).toEqual(starts.slice(future.length).sort((a, b) => b - a));
    expect((await s.search(ACTOR, "cardiolog")).bookings).toHaveLength(10);
    expect((await s.search(ACTOR, "zzzz")).bookings).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("Outra Clínica");
  });

  it("q curto => 422; 60/min por conta => RATE_LIMITED (partilhado entre listagem e pesquisa)", async () => {
    const s = setup();
    await expect(s.search(ACTOR, "a")).rejects.toBeInstanceOf(ValidationError);
    for (let i = 0; i < 60; i++) await s.search(ACTOR, "ab");
    await expect(s.search(ACTOR, "ab")).rejects.toBeInstanceOf(RateLimitedError);
    expect(s.fx.audit.events).toEqual([]);
  });

  it("ficha: marcações Vita só pela ligação (revogada => só visitas), exames e recomendações da clínica; mais recentes primeiro", async () => {
    const s = setup();
    s.slot("s1", "2026-11-10T09:00:00Z", { professionalName: "Dra. Lima" });
    const patient = await linkedPatient(s, { level: "BOOKINGS" });
    await s.book({}, ACTOR, { clinicPatientId: patient.id, slotId: "s1" }, CTX).catch(() => undefined);
    s.fx.calendar.appointments = [
      { id: "ap-1", status: "COMPLETED", startsAt: at("2026-10-01T09:00:00Z"), durationMinutes: 30, specialty: "Cardiologia", familyId: FAMILY, memberId: MEMBER, confirmationStatus: "PENDING" },
      { id: "ap-2", status: "SCHEDULED", startsAt: at("2026-11-20T09:00:00Z"), durationMinutes: 30, familyId: FAMILY, memberId: MEMBER, confirmationStatus: "PENDING" },
    ];
    s.fx.calendar.examinations = [{ id: "ex-1", status: "COMPLETED", startsAt: at("2026-09-01T09:00:00Z"), examType: "Eco", familyId: FAMILY, memberId: MEMBER, resultsCount: 3 }];
    s.fx.recommendations.items = [{ id: "rec-1", memberId: MEMBER, appointmentId: "ap-1", text: "Beber água", createdAt: at("2026-10-02T09:00:00Z") }];
    const withLink = await s.record(ACTOR, patient.id);
    expect(withLink.bookings.map((b) => b.id).slice(0, 2)).toEqual(expect.arrayContaining(["ap-2"]));
    expect(withLink.bookings.filter((b) => b.source === "VITA").map((b) => b.id)).toEqual(["ap-2", "ap-1"]);
    expect(withLink.examinations).toMatchObject([{ id: "ex-1", resultsCount: 3, examType: "Eco" }]);
    expect(withLink.recommendations).toMatchObject([{ id: "rec-1", text: "Beber água" }]);
    expect(JSON.stringify(withLink)).not.toContain(FAMILY);
    expect(JSON.stringify(withLink)).not.toContain(MEMBER);
    // ligação revogada: deixam de aparecer as marcações Vita, exames e recomendações; ficam as visitas manuais
    s.fx.linksRepo.links.length = 0;
    const revoked = await s.record(ACTOR, patient.id);
    expect(revoked.bookings.every((b) => b.source === "MANUAL")).toBe(true);
    expect(revoked.examinations).toEqual([]);
    expect(revoked.recommendations).toEqual([]);
  });

  it("ficha de outra clínica => NOT_FOUND", async () => {
    const s = setup();
    const patient = await s.create(ACTOR, { name: "Ana" }, CTX);
    await expect(s.record(OTHER_ACTOR, patient.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("job clinic-patients.purge-link-codes (BR-CLN-20)", () => {
  it("apaga expirados/usados há mais de 24 h, mantém os recentes e ativos; auditoria SYSTEM só com a contagem", async () => {
    const s = setup();
    const hour = 3_600_000;
    const mk = (id: string, expiresAgoH: number, usedAgoH?: number) => ({
      id,
      familyId: FAMILY,
      memberId: MEMBER,
      codeHash: id,
      createdAt: NOW,
      createdByUserId: null,
      expiresAt: new Date(NOW.getTime() - expiresAgoH * hour),
      ...(usedAgoH !== undefined ? { usedAt: new Date(NOW.getTime() - usedAgoH * hour) } : {}),
    });
    s.fx.codesRepo.codes.push(mk("expired-old", 30), mk("expired-recent", 2), mk("used-old", -1, 30), mk("used-recent", -1, 1), mk("active", -0.1));
    expect(await s.purge()).toEqual({ removed: 2 });
    expect(s.fx.codesRepo.codes.map((c) => c.id).sort()).toEqual(["active", "expired-recent", "used-recent"]);
    expect(s.fx.audit.events.at(-1)).toMatchObject({ action: "CLINIC_LINK_CODES_PURGE", actorType: "SYSTEM", result: "SUCCESS", metadata: { removed: 2 } });
    expect(await s.purge()).toEqual({ removed: 0 });
  });
});
