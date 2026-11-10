// AC-EXM-03 (marcação direta num horário EXAM com vagas, ADR-023 revisto 2026-11-04), AC-EXM-04 (cancelar),
// AC-EXM-05 (completar com resultados), AC-EXM-06 (PDF da clínica), BR-CLN-03 (minimização),
// BR-EXM-05..08, BR-APT-11, UC-EXM-08, UC-CLN-08..10.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import {
  createCancelClinicExaminationUseCase,
  createCompleteClinicExaminationUseCase,
  createDeleteClinicExamDocumentUseCase,
  createListClinicExamAgendaUseCase,
  createUploadClinicExamDocumentUseCase,
} from "./clinic-examinations.js";
import { createCreateExaminationUseCase } from "./create-examination.js";
import { createExaminationsFixtures, type ExaminationsFixtures } from "./fixtures.js";
import { createGetExaminationUseCase } from "./get-examination.js";
import type { ClinicPortalActor } from "./ports.js";
import { createSetExaminationStatusUseCase } from "./set-examination-status.js";
import { createUpdateExaminationUseCase } from "./update-examination.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const SLOT_AT = new Date("2026-02-01T09:30:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const MEMBER_2 = "m2";
const MEMBER_3 = "m3";
const ACTOR = { userId: "u1", platformAdmin: false };
const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";
const CLINIC_ACTOR: ClinicPortalActor = { clinicAccountId: "acc-a", clinicId: CLINIC_A };
const OTHER_CLINIC_ACTOR: ClinicPortalActor = { clinicAccountId: "acc-b", clinicId: CLINIC_B };

function setup(clock: FixedClock = new FixedClock(NOW)): ExaminationsFixtures {
  const fixtures = createExaminationsFixtures(clock);
  fixtures.clinics.seed(CLINIC_A, "Clínica Sol", FAMILY_ID);
  fixtures.clinics.seedSlot({ id: "slot-exam", clinicId: CLINIC_A, kind: "EXAM", specialty: "Ecografia abdominal", startsAt: SLOT_AT, durationMinutes: 30, capacity: 1 });
  fixtures.clinics.seedSlot({ id: "slot-multi", clinicId: CLINIC_A, kind: "EXAM", specialty: "Análises", startsAt: SLOT_AT, durationMinutes: 30, capacity: 2 });
  fixtures.clinics.seedSlot({ id: "slot-2", clinicId: CLINIC_A, kind: "EXAM", specialty: "Ecografia abdominal", startsAt: new Date("2026-02-01T10:00:00.000Z"), durationMinutes: 30, capacity: 1 });
  fixtures.clinics.seedSlot({ id: "slot-appt", clinicId: CLINIC_A, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt: SLOT_AT, durationMinutes: 30, capacity: 1 });
  fixtures.memberNames.names.set(`${FAMILY_ID}:${MEMBER_ID}`, "Maria Silva");
  return fixtures;
}

/** Marcação direta (ADR-023 revisto): nasce SCHEDULED. */
async function request(fixtures: ExaminationsFixtures, slotId = "slot-exam", notes = "em jejum", memberId = MEMBER_ID) {
  return createCreateExaminationUseCase(fixtures.deps)(ACTOR, FAMILY_ID, memberId, { name: "ignorado", examDate: "1999-01-01", slotId, notes }, CTX);
}

describe("createExamination com slotId (UC-EXM-08, AC-EXM-03, BR-EXM-05, BR-APT-11)", () => {
  it("nasce SCHEDULED com tipo, data/hora e clínica congelados do horário e audita EXAM_CREATE com slotId", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);

    expect(examination.status).toBe("SCHEDULED");
    expect(examination.name).toBe("Ecografia abdominal");
    expect(examination.examDate).toBe("2026-02-01");
    expect(examination.scheduledAt?.toISOString()).toBe(SLOT_AT.toISOString());
    expect(examination.slotId).toBe("slot-exam");
    expect(examination.clinicId).toBe(CLINIC_A);
    expect(examination.clinicName).toBe("Clínica Sol");
    expect(examination.notes).toBe("em jejum");
    expect(examination.issuedBy).toBe("FAMILY");
    const event = fixtures.audit.events.find((e) => e.action === "EXAM_CREATE");
    expect(event).toMatchObject({ actorType: "USER", metadata: { slotId: "slot-exam" } });
    expect(fixtures.audit.events.map((e) => e.action)).not.toContain("EXAM_REQUEST");
  });

  it("horário de 1 vaga: segunda marcação -> CONFLICT; cancelar liberta a vaga", async () => {
    const fixtures = setup();
    const first = await request(fixtures);
    await expect(request(fixtures, "slot-exam", "x", MEMBER_2)).rejects.toMatchObject({ code: "CONFLICT" });

    await createSetExaminationStatusUseCase(fixtures.deps)(ACTOR, FAMILY_ID, MEMBER_ID, first.id, { status: "CANCELLED" }, CTX);
    await expect(request(fixtures, "slot-exam", "x", MEMBER_2)).resolves.toMatchObject({ status: "SCHEDULED" });
  });

  it("horário com capacity 2: duas marcações de membros distintos, a terceira -> CONFLICT", async () => {
    const fixtures = setup();
    await request(fixtures, "slot-multi", "a", MEMBER_ID);
    await request(fixtures, "slot-multi", "b", MEMBER_2);
    await expect(request(fixtures, "slot-multi", "c", MEMBER_3)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("o mesmo membro não ocupa duas vagas do mesmo horário (CONFLICT), mesmo havendo vagas", async () => {
    const fixtures = setup();
    await request(fixtures, "slot-multi");
    await expect(request(fixtures, "slot-multi")).rejects.toMatchObject({ code: "CONFLICT" });
    expect([...fixtures.examinationsRepo.byId.values()]).toHaveLength(1);
  });

  it("COMPLETED e CANCELLED não ocupam vaga", async () => {
    const fixtures = setup();
    const a = await request(fixtures, "slot-multi", "a", MEMBER_ID);
    await request(fixtures, "slot-multi", "b", MEMBER_2);
    await createCancelClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, a.id, { note: "x" }, CTX);
    await expect(request(fixtures, "slot-multi", "c", MEMBER_3)).resolves.toMatchObject({ status: "SCHEDULED" });
  });

  it("horário de consulta (BR-APT-10) -> VALIDATION_ERROR; horário inexistente/removido ou já passado -> CONFLICT", async () => {
    const fixtures = setup();
    await expect(request(fixtures, "slot-appt")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(request(fixtures, "nope")).rejects.toMatchObject({ code: "CONFLICT" });

    const past = setup(new FixedClock(new Date("2026-02-01T09:30:00.000Z")));
    await expect(request(past)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("slotId é incompatível com clinicId/clinicName (VALIDATION_ERROR)", async () => {
    const fixtures = setup();
    const create = createCreateExaminationUseCase(fixtures.deps);
    await expect(create(ACTOR, FAMILY_ID, MEMBER_ID, { name: "x", examDate: "2026-02-01", slotId: "slot-exam", clinicId: CLINIC_A }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("exige WRITE(EXAMS): a política é consultada com CREATE/EXAMS", async () => {
    const fixtures = setup();
    await request(fixtures);
    expect(fixtures.policy.calls[0]).toMatchObject({ action: "CREATE", category: "EXAMS", subjectMemberId: MEMBER_ID });
  });
});

describe("família sobre uma marcação SCHEDULED (state-machines.md, BR-EXM-08)", () => {
  it("BR-EXM-08: um exame com slotId cancelado não se reagenda (INVALID_STATE_TRANSITION); desistir liberta o horário", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    const setStatus = createSetExaminationStatusUseCase(fixtures.deps);
    await setStatus(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { status: "CANCELLED" }, CTX);

    await expect(setStatus(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { status: "SCHEDULED" }, CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(request(fixtures)).resolves.toMatchObject({ status: "SCHEDULED" });
  });

  it("REQUESTED/REJECTED já não existem como destino de transição", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    const setStatus = createSetExaminationStatusUseCase(fixtures.deps);
    await expect(setStatus(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { status: "REQUESTED" as "SCHEDULED" }, CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
    await expect(setStatus(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { status: "REJECTED" as "SCHEDULED" }, CTX)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });
  });

  it("BR-EXM-08: só as observações são editáveis num exame de clínica parceira", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    const update = createUpdateExaminationUseCase(fixtures.deps);

    await expect(update(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { examDate: "2026-03-01" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(update(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { name: "outro" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(update(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, { notes: "novas notas" }, CTX)).resolves.toMatchObject({ notes: "novas notas" });
  });

  it("um exame sem horário (registado à mão pela família, mesmo com clinicId) não é visível à clínica", async () => {
    const fixtures = setup();
    const create = createCreateExaminationUseCase(fixtures.deps);
    const manual = await create(ACTOR, FAMILY_ID, MEMBER_ID, { name: "Hemograma", examDate: "2026-02-10", clinicId: CLINIC_A }, CTX);

    expect(await createListClinicExamAgendaUseCase(fixtures.deps)(CLINIC_ACTOR, {})).toEqual([]);
    await expect(createCancelClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, manual.id, { note: "x" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listas e minimização (BR-CLN-03)", () => {
  it("a agenda é só da própria clínica; a vista tem apenas o mínimo (nunca família/saúde)", async () => {
    const fixtures = setup();
    await request(fixtures);
    const list = createListClinicExamAgendaUseCase(fixtures.deps);

    const own = await list(CLINIC_ACTOR, {});
    expect(own).toHaveLength(1);
    expect(Object.keys(own[0] ?? {}).sort()).toEqual(["documents", "examType", "hasResultsDraft", "id", "notes", "patientName", "reportAvailable", "resultsCount", "scheduledAt", "status"]);
    expect(own[0]).toMatchObject({ patientName: "Maria Silva", examType: "Ecografia abdominal", status: "SCHEDULED", notes: "em jejum", resultsCount: 0 });
    expect(await list(OTHER_CLINIC_ACTOR, {})).toEqual([]);
  });

  it("agenda lista confirmados e desfechos, por ordem cronológica, e respeita from/to", async () => {
    const fixtures = setup();
    await request(fixtures, "slot-2");
    await request(fixtures, "slot-exam");
    await request(fixtures, "slot-appt").catch(() => undefined);
    const agenda = createListClinicExamAgendaUseCase(fixtures.deps);

    const all = await agenda(CLINIC_ACTOR, {});
    expect(all.map((v) => v.scheduledAt)).toEqual([SLOT_AT.toISOString(), "2026-02-01T10:00:00.000Z"]);
    expect(await agenda(CLINIC_ACTOR, { from: new Date("2026-02-01T09:45:00.000Z") })).toHaveLength(1);
    expect(await agenda(OTHER_CLINIC_ACTOR, {})).toEqual([]);
  });
});

describe("cancelClinicExamination (UC-CLN-09)", () => {
  it("sem motivo -> VALIDATION_ERROR", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    await expect(createCancelClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, { note: "   " }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("com motivo -> CANCELLED, horário livre, EXAM_CLINIC_CANCEL e EXAM_CANCELLED", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    fixtures.alerts.events.length = 0;

    const view = await createCancelClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, { note: "avaria no equipamento" }, CTX);

    expect(view.status).toBe("CANCELLED");
    expect(view.responseNote).toBe("avaria no equipamento");
    expect(fixtures.audit.events.map((e) => e.action)).toContain("EXAM_CLINIC_CANCEL");
    expect(fixtures.alerts.events.map((e) => e.type)).toEqual(["EXAM_CANCELLED"]);
    await expect(request(fixtures)).resolves.toMatchObject({ status: "SCHEDULED" });
  });

  it("só exames SCHEDULED e futuros: já cancelado ou já passado -> CONFLICT; outra clínica -> NOT_FOUND", async () => {
    const done = setup();
    const cancelled = await request(done);
    await createCancelClinicExaminationUseCase(done.deps)(CLINIC_ACTOR, cancelled.id, { note: "x" }, CTX);
    await expect(createCancelClinicExaminationUseCase(done.deps)(CLINIC_ACTOR, cancelled.id, { note: "x" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });

    const clock = new FixedClock(NOW);
    const past = setup(clock);
    const confirmed = await request(past);
    clock.set(new Date("2026-02-01T09:30:00.000Z"));
    await expect(createCancelClinicExaminationUseCase(past.deps)(CLINIC_ACTOR, confirmed.id, { note: "x" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });

    const other = setup();
    const own = await request(other);
    await expect(createCancelClinicExaminationUseCase(other.deps)(OTHER_CLINIC_ACTOR, own.id, { note: "x" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("completeClinicExamination (UC-CLN-10, AC-EXM-05, BR-CLN-08, D11)", () => {
  const RESULTS = [
    { parameter: " Glicemia ", valueNumeric: 250, unit: "mg/dL", referenceMin: 70, referenceMax: 100 },
    { parameter: "Observação", valueText: "sem alterações" },
  ];

  it("SCHEDULED -> COMPLETED com 2 parâmetros: grava resultados, issuedBy=CLINIC e avisa EXAM_RESULTS_AVAILABLE", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    fixtures.alerts.events.length = 0;

    const view = await createCompleteClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, { results: RESULTS, resultNote: "  nota  " }, CTX);

    expect(view).toMatchObject({ status: "COMPLETED", resultsCount: 2 });
    expect(view.resultsIssuedAt).toBe(NOW.toISOString());
    const stored = await fixtures.examinationsRepo.findById({}, FAMILY_ID, MEMBER_ID, examination.id);
    expect(stored).toMatchObject({ status: "COMPLETED", issuedBy: "CLINIC", issuedByClinicAccountId: "acc-a", clinicResultNote: "nota" });
    const results = await fixtures.examResultsRepo.listByExamination({}, examination.id);
    expect(results.map((r) => r.parameter)).toEqual(["Glicemia", "Observação"]);
    // D11: valor fora do intervalo guardado tal como veio — o único alerta é o genérico de resultados.
    expect(fixtures.alerts.events.map((e) => e.type)).toEqual(["EXAM_RESULTS_AVAILABLE"]);
    const audit = fixtures.audit.events.find((e) => e.action === "EXAM_CLINIC_COMPLETE");
    expect(audit?.metadata).toEqual({ from: "SCHEDULED", to: "COMPLETED", resultsCount: 2, documentsCount: 0 });
    expect(JSON.stringify(audit)).not.toContain("Glicemia");
  });

  it("a vista do portal nunca devolve os valores dos resultados (só a contagem)", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    const view = await createCompleteClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, { results: RESULTS }, CTX);
    expect(JSON.stringify(view)).not.toContain("250");
    expect(JSON.stringify(view)).not.toContain("Glicemia");
  });

  it("sem resultados nem PDF -> VALIDATION_ERROR e o exame fica SCHEDULED", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    await expect(createCompleteClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, { results: [] }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await fixtures.examinationsRepo.findById({}, FAMILY_ID, MEMBER_ID, examination.id))?.status).toBe("SCHEDULED");
  });

  it("só um PDF carregado chega (resultsCount 0)", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    await createUploadClinicExamDocumentUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, { file: { buffer: Buffer.from("%PDF-1.4"), originalName: "r.pdf" } }, CTX);
    const view = await createCompleteClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, {}, CTX);
    expect(view.status).toBe("COMPLETED");
    expect(view.documents).toHaveLength(1);
  });

  it("mais de 50 parâmetros, nota > 2000 ou parâmetro inválido -> VALIDATION_ERROR (sem efeitos)", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    const complete = createCompleteClinicExaminationUseCase(fixtures.deps);
    const many = Array.from({ length: 51 }, (_, i) => ({ parameter: `p${String(i)}`, valueNumeric: i }));

    await expect(complete(CLINIC_ACTOR, examination.id, { results: many }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(complete(CLINIC_ACTOR, examination.id, { results: RESULTS, resultNote: "x".repeat(2001) }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(complete(CLINIC_ACTOR, examination.id, { results: [{ parameter: "  " , valueText: "a" }] }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(complete(CLINIC_ACTOR, examination.id, { results: [{ parameter: "x" }] }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await fixtures.examResultsRepo.listByExamination({}, examination.id)).toEqual([]);
  });

  it("exame cancelado -> CONFLICT; de outra clínica -> NOT_FOUND; completar duas vezes -> CONFLICT", async () => {
    const fixtures = setup();
    const cancelled = await request(fixtures, "slot-exam");
    const complete = createCompleteClinicExaminationUseCase(fixtures.deps);
    await createCancelClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, cancelled.id, { note: "x" }, CTX);
    await expect(complete(CLINIC_ACTOR, cancelled.id, { results: RESULTS }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });

    const examination = await request(fixtures, "slot-2");
    await expect(complete(OTHER_CLINIC_ACTOR, examination.id, { results: RESULTS }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await complete(CLINIC_ACTOR, examination.id, { results: RESULTS }, CTX);
    await expect(complete(CLINIC_ACTOR, examination.id, { results: RESULTS }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("depois de COMPLETED o paciente vê os resultados e o titular/tutor continua a poder editar (issuedBy=CLINIC)", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    await createCompleteClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, { results: RESULTS }, CTX);

    const view = await createGetExaminationUseCase(fixtures.deps)(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, CTX);
    expect(view.results).toHaveLength(2);
    expect(view.issuedBy).toBe("CLINIC");
  });
});

describe("PDF da clínica (BR-CLN-08, AC-EXM-06)", () => {
  const FILE = { buffer: Buffer.from("%PDF-1.4"), originalName: "resultados.pdf" };

  it("só em exame SCHEDULED da própria clínica; a resposta tem só metadados", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    const upload = createUploadClinicExamDocumentUseCase(fixtures.deps);

    await createCancelClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, { note: "x" }, CTX);
    await expect(upload(CLINIC_ACTOR, examination.id, { file: FILE }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    const second = await request(fixtures, "slot-2");
    await expect(upload(OTHER_CLINIC_ACTOR, second.id, { file: FILE }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const view = await upload(CLINIC_ACTOR, second.id, { file: FILE }, CTX);
    expect(Object.keys(view).sort()).toEqual(["createdAt", "generatedBySystem", "id", "originalName", "scanStatus", "sizeBytes"]);
    expect(view.scanStatus).toBe("PENDING");
    expect(fixtures.documents.clinicUploads).toEqual([{ clinicAccountId: "acc-a", examinationId: second.id, originalName: "resultados.pdf" }]);
  });

  it("o paciente não vê o PDF da clínica antes de COMPLETED, e vê-o depois", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    await createUploadClinicExamDocumentUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, { file: FILE }, CTX);
    const get = createGetExaminationUseCase(fixtures.deps);

    expect((await get(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, CTX)).documentIds).toEqual([]);
    await createCompleteClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, {}, CTX);
    expect((await get(ACTOR, FAMILY_ID, MEMBER_ID, examination.id, CTX)).documentIds).toHaveLength(1);
  });

  it("remover: só os da clínica, só com o exame SCHEDULED (depois de COMPLETED -> CONFLICT)", async () => {
    const fixtures = setup();
    const examination = await request(fixtures);
    const doc = await createUploadClinicExamDocumentUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, { file: FILE }, CTX);
    const remove = createDeleteClinicExamDocumentUseCase(fixtures.deps);

    await expect(remove(OTHER_CLINIC_ACTOR, examination.id, doc.id, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await remove(CLINIC_ACTOR, examination.id, doc.id, CTX);
    expect(fixtures.documents.clinicDeletes).toHaveLength(1);

    const second = await createUploadClinicExamDocumentUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, { file: FILE }, CTX);
    await createCompleteClinicExaminationUseCase(fixtures.deps)(CLINIC_ACTOR, examination.id, {}, CTX);
    await expect(remove(CLINIC_ACTOR, examination.id, second.id, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
