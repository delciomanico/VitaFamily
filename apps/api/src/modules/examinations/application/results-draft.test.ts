// AC-CLN-32/33 / TC-CLN-23/24 (BR-CLN-47..49, regras de aplicação sobre fakes): rascunho de resultados sem concluir (o paciente
// não vê nada), `complete` com/sem rascunho, laudo PDF gerado na mesma transação (instantâneo, `generateReport`, falha => sem
// efeitos), descarga só do laudo gerado, permissões (Admin, Gestor, Médico nos seus), isolamento, auditoria sem valores.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createCancelClinicExaminationUseCase, createCompleteClinicExaminationUseCase, createListClinicExamAgendaUseCase } from "./clinic-examinations.js";
import { createCreateExaminationUseCase } from "./create-examination.js";
import { createExaminationsFixtures, type ExaminationsFixtures } from "./fixtures.js";
import type { ClinicPortalActor } from "./ports.js";
import { createDiscardResultsDraftUseCase, createDownloadExamReportUseCase, createGetResultsDraftUseCase, createSaveResultsDraftUseCase } from "./results-draft.js";
import { createGetExaminationUseCase } from "./get-examination.js";

const NOW = new Date("2026-01-15T10:00:00.000Z");
const SLOT_AT = new Date("2026-02-01T09:30:00.000Z");
const CTX = { requestId: "req-1" };
const FAMILY_ID = "f1";
const MEMBER_ID = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };
const CLINIC_A = "clinic-a";
const ADMIN: ClinicPortalActor = { clinicAccountId: "acc-a", clinicId: CLINIC_A };
const DOCTOR: ClinicPortalActor = { clinicAccountId: "doc-1", clinicId: CLINIC_A, professionalId: "prof-1" };
const OTHER_DOCTOR: ClinicPortalActor = { clinicAccountId: "doc-2", clinicId: CLINIC_A, professionalId: "prof-2" };
const OTHER_CLINIC: ClinicPortalActor = { clinicAccountId: "acc-b", clinicId: "clinic-b" };
const RESULTS = [
  { parameter: " Hemoglobina ", valueNumeric: 11.2, unit: "g/dL", referenceMin: 12, referenceMax: 16 },
  { parameter: "Glicose", valueNumeric: 99, unit: "mg/dL", referenceMin: 70, referenceMax: 99 },
  { parameter: "Cor", valueText: "Amarela" },
];

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

function setup() {
  const clock = new FixedClock(NOW);
  const f: ExaminationsFixtures = createExaminationsFixtures(clock);
  f.clinics.seed(CLINIC_A, "Clínica Sol", FAMILY_ID);
  f.clinics.seedSlot({ id: "slot-1", clinicId: CLINIC_A, kind: "EXAM", specialty: "Análises", startsAt: SLOT_AT, durationMinutes: 30, capacity: 3, professionalId: "prof-1" });
  f.clinics.seedSlot({ id: "slot-2", clinicId: CLINIC_A, kind: "EXAM", specialty: "Análises", startsAt: SLOT_AT, durationMinutes: 30, capacity: 3, professionalId: "prof-2" });
  f.memberNames.names.set(`${FAMILY_ID}:${MEMBER_ID}`, "Maria Silva");
  return {
    ...f,
    book: (slotId = "slot-1", memberId = MEMBER_ID) => createCreateExaminationUseCase(f.deps)(ACTOR, FAMILY_ID, memberId, { name: "x", examDate: "1999-01-01", slotId }, CTX),
    save: createSaveResultsDraftUseCase(f.deps),
    get: createGetResultsDraftUseCase(f.deps),
    discard: createDiscardResultsDraftUseCase(f.deps),
    complete: createCompleteClinicExaminationUseCase(f.deps),
    download: createDownloadExamReportUseCase(f.deps),
    cancel: createCancelClinicExaminationUseCase(f.deps),
    list: createListClinicExamAgendaUseCase(f.deps),
  };
}

describe("rascunho de resultados (UC-CLN-37, BR-CLN-47)", () => {
  it("guarda sem concluir: o exame fica SCHEDULED, não há exam_results, o paciente não vê nada; GET devolve-o; PUT substitui", async () => {
    const s = setup();
    const exam = await s.book();
    const saved = await s.save(ADMIN, exam.id, { results: RESULTS, resultNote: "  nota  " }, CTX);
    expect(saved).toMatchObject({ examinationId: exam.id, status: "DRAFT", resultNote: "nota", updatedAt: NOW.toISOString() });
    expect(saved.results.map((r) => r.parameter)).toEqual(["Hemoglobina", "Glicose", "Cor"]);
    expect((await s.examinationsRepo.findById({}, FAMILY_ID, MEMBER_ID, exam.id))?.status).toBe("SCHEDULED");
    expect(await s.examResultsRepo.listByExamination({}, exam.id)).toEqual([]);
    expect(s.alerts.events).toEqual([]);
    const seenByPatient = await createGetExaminationUseCase(s.deps)(ACTOR, FAMILY_ID, MEMBER_ID, exam.id, CTX);
    expect(seenByPatient.results).toEqual([]);
    expect(JSON.stringify(seenByPatient)).not.toContain("Hemoglobina");
    expect((await s.get(ADMIN, exam.id)).results).toHaveLength(3);
    await s.save(ADMIN, exam.id, { resultNote: "só nota" }, CTX);
    expect(await s.get(ADMIN, exam.id)).toMatchObject({ results: [], resultNote: "só nota" });
  });

  it("a vista da agenda indica hasResultsDraft (e nunca os valores)", async () => {
    const s = setup();
    const exam = await s.book();
    expect((await s.list(ADMIN, {}))[0]).toMatchObject({ hasResultsDraft: false, reportAvailable: false });
    await s.save(ADMIN, exam.id, { results: RESULTS }, CTX);
    const view = (await s.list(ADMIN, {}))[0];
    expect(view).toMatchObject({ hasResultsDraft: true });
    expect(JSON.stringify(view)).not.toContain("Hemoglobina");
  });

  it("permissões = as de complete: Admin, Gestor (sem professionalId) e Médico nos seus; outro Médico, outra clínica => NOT_FOUND", async () => {
    const s = setup();
    const exam = await s.book("slot-1");
    expect((await s.save(DOCTOR, exam.id, { results: RESULTS }, CTX)).status).toBe("DRAFT");
    expect((await s.get(ADMIN, exam.id)).results).toHaveLength(3);
    expect(await codeOf(s.save(OTHER_DOCTOR, exam.id, { results: RESULTS }, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.get(OTHER_DOCTOR, exam.id))).toBe("NOT_FOUND");
    expect(await codeOf(s.discard(OTHER_DOCTOR, exam.id, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.save(OTHER_CLINIC, exam.id, { results: RESULTS }, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.get(OTHER_CLINIC, exam.id))).toBe("NOT_FOUND");
    expect(await codeOf(s.get(ADMIN, "inexistente"))).toBe("NOT_FOUND");
  });

  it("validação: sem resultados nem nota, >50, nota >2000, parâmetro vazio, sem valor, min>max, campo extra => VALIDATION_ERROR", async () => {
    const s = setup();
    const exam = await s.book();
    const bad: unknown[] = [
      {},
      { results: [] },
      { resultNote: "   " },
      { results: Array.from({ length: 51 }, (_, i) => ({ parameter: `p${String(i)}`, valueNumeric: i })) },
      { results: RESULTS, resultNote: "x".repeat(2001) },
      { results: [{ parameter: "  ", valueText: "a" }] },
      { results: [{ parameter: "x" }] },
      { results: [{ parameter: "x", valueNumeric: 1, referenceMin: 5, referenceMax: 2 }] },
      { results: RESULTS, extra: true },
      { results: "texto" },
      null,
    ];
    for (const body of bad) expect(await codeOf(s.save(ADMIN, exam.id, body, CTX)), JSON.stringify(body)).toBe("VALIDATION_ERROR");
    expect(await codeOf(s.get(ADMIN, exam.id))).toBe("NOT_FOUND");
  });

  it("exame não SCHEDULED => INVALID_STATE_TRANSITION (concluído, cancelado)", async () => {
    const s = setup();
    const done = await s.book();
    await s.complete(ADMIN, done.id, { results: RESULTS }, CTX);
    expect(await codeOf(s.save(ADMIN, done.id, { results: RESULTS }, CTX))).toBe("INVALID_STATE_TRANSITION");
    const cancelled = await s.book("slot-2");
    await s.cancel(ADMIN, cancelled.id, { note: "x" }, CTX);
    expect(await codeOf(s.save(ADMIN, cancelled.id, { results: RESULTS }, CTX))).toBe("INVALID_STATE_TRANSITION");
  });

  it("DELETE é idempotente (sem rascunho => ok); auditoria SAVED/DISCARDED só com contagens, nunca valores", async () => {
    const s = setup();
    const exam = await s.book();
    await s.discard(ADMIN, exam.id, CTX);
    expect(s.audit.events.filter((e) => e.action === "EXAM_RESULTS_DRAFT_DISCARDED")).toHaveLength(0);
    await s.save(ADMIN, exam.id, { results: RESULTS, resultNote: "nota secreta" }, CTX);
    await s.discard(ADMIN, exam.id, CTX);
    await s.discard(ADMIN, exam.id, CTX);
    expect(await codeOf(s.get(ADMIN, exam.id))).toBe("NOT_FOUND");
    const events = s.audit.events.filter((e) => e.action.startsWith("EXAM_RESULTS_DRAFT"));
    expect(events.map((e) => [e.action, e.metadata])).toEqual([
      ["EXAM_RESULTS_DRAFT_SAVED", { resultsCount: 3 }],
      ["EXAM_RESULTS_DRAFT_DISCARDED", { resultsCount: 3 }],
    ]);
    expect(events[0]).toMatchObject({ actorType: "CLINIC_ACCOUNT", actorClinicId: CLINIC_A, actorClinicAccountId: "acc-a", resourceType: "Examination", resourceId: exam.id });
    expect(JSON.stringify(s.audit.events)).not.toMatch(/Hemoglobina|nota secreta|11\.2/);
  });

  it("rate limit de escrita: 60/min por conta", async () => {
    const s = setup();
    const exam = await s.book();
    for (let i = 0; i < 60; i += 1) await s.save(ADMIN, exam.id, { results: RESULTS }, CTX);
    expect(await codeOf(s.save(ADMIN, exam.id, { results: RESULTS }, CTX))).toBe("RATE_LIMITED");
    expect((await s.save(OTHER_DOCTOR, exam.id, { results: RESULTS }, CTX).catch((e: unknown) => (e as { code: string }).code))).toBe("NOT_FOUND");
  });
});

describe("complete com rascunho e laudo (BR-CLN-47/48/49)", () => {
  it("sem results no corpo usa o rascunho (resultados e nota) e apaga-o na mesma operação", async () => {
    const s = setup();
    const exam = await s.book();
    await s.save(ADMIN, exam.id, { results: RESULTS, resultNote: "nota do rascunho" }, CTX);
    const view = await s.complete(ADMIN, exam.id, {}, CTX);
    expect(view).toMatchObject({ status: "COMPLETED", resultsCount: 3, hasResultsDraft: false, reportAvailable: true });
    expect((await s.examResultsRepo.listByExamination({}, exam.id)).map((r) => r.parameter)).toEqual(["Hemoglobina", "Glicose", "Cor"]);
    expect((await s.examinationsRepo.findById({}, FAMILY_ID, MEMBER_ID, exam.id))?.clinicResultNote).toBe("nota do rascunho");
    expect(s.drafts.byExam.size).toBe(0);
  });

  it("com results (mesmo []) usa o pedido e ignora o rascunho (que também se apaga)", async () => {
    const s = setup();
    const exam = await s.book();
    await s.save(ADMIN, exam.id, { results: RESULTS }, CTX);
    expect(await codeOf(s.complete(ADMIN, exam.id, { results: [] }, CTX))).toBe("VALIDATION_ERROR");
    expect(s.drafts.byExam.size).toBe(1); // a falha não toca no rascunho
    const view = await s.complete(ADMIN, exam.id, { results: [{ parameter: "Só um", valueNumeric: 1 }] }, CTX);
    expect(view.resultsCount).toBe(1);
    expect(s.drafts.byExam.size).toBe(0);
  });

  it("cancelar o exame apaga o rascunho", async () => {
    const s = setup();
    const exam = await s.book();
    await s.save(ADMIN, exam.id, { results: RESULTS }, CTX);
    await s.cancel(ADMIN, exam.id, { note: "motivo" }, CTX);
    expect(s.drafts.byExam.size).toBe(0);
  });

  it("gera o laudo por omissão: Document gerado (instantâneo), pedido ao gerador com os dados emitidos, auditoria só com contagens", async () => {
    const s = setup();
    const exam = await s.book();
    const view = await s.complete(DOCTOR, exam.id, { results: RESULTS, resultNote: "n" }, CTX);
    expect(view).toMatchObject({ status: "COMPLETED", reportAvailable: true });
    expect(view.documents).toEqual([expect.objectContaining({ generatedBySystem: true, scanStatus: "CLEAN", originalName: "laudo-20260201.pdf" })]);
    expect(s.documents.stored).toHaveLength(1);
    expect(s.reportGenerator.requests[0]).toMatchObject({ clinicId: CLINIC_A, slotId: "slot-1", patientName: "Maria Silva", examName: "Análises", examDate: "2026-02-01", resultNote: "n" });
    expect(s.reportGenerator.requests[0]?.results.map((r) => r.parameter)).toEqual(["Hemoglobina", "Glicose", "Cor"]);
    const generated = s.audit.events.find((e) => e.action === "EXAM_REPORT_GENERATED");
    expect(generated).toMatchObject({ actorType: "CLINIC_ACCOUNT", actorClinicId: CLINIC_A, resourceType: "Document", resourceId: "gen-1", metadata: { resultsCount: 3, outOfReferenceCount: 1 } });
    expect(JSON.stringify(s.audit.events)).not.toMatch(/Hemoglobina|11\.2|Amarela/);
    expect(s.alerts.events.map((e) => e.type)).toEqual(["EXAM_RESULTS_AVAILABLE"]);
  });

  it("generateReport=false, só PDF carregado ou sem resultados estruturados => sem laudo; PDF carregado coexiste", async () => {
    const s = setup();
    const a = await s.book();
    expect((await s.complete(ADMIN, a.id, { results: RESULTS, generateReport: false }, CTX)).reportAvailable).toBe(false);
    const b = await s.book("slot-2");
    s.documents.seed("EXAMINATION", b.id, [
      { id: "up-1", familyId: FAMILY_ID, memberId: MEMBER_ID, resourceType: "EXAMINATION", resourceId: b.id, storageKey: "k", originalName: "r.pdf", mimeType: "application/pdf", sizeBytes: 1, checksumSha256: "x", scanStatus: "CLEAN", uploadedByClinic: true, generatedBySystem: false, createdAt: NOW },
    ]);
    expect((await s.complete(ADMIN, b.id, {}, CTX)).reportAvailable).toBe(false);
    expect(s.documents.stored).toHaveLength(0);
  });

  it("falha na geração => a conclusão falha sem efeitos (INTERNAL_ERROR): exame SCHEDULED, sem resultados, rascunho e documento intactos; generateReport=false conclui", async () => {
    const s = setup();
    const exam = await s.book();
    await s.save(ADMIN, exam.id, { results: RESULTS }, CTX);
    s.reportGenerator.failWith = new Error("pdf");
    expect(await codeOf(s.complete(ADMIN, exam.id, {}, CTX))).toBe("INTERNAL_ERROR");
    expect((await s.examinationsRepo.findById({}, FAMILY_ID, MEMBER_ID, exam.id))?.status).toBe("SCHEDULED");
    expect(await s.examResultsRepo.listByExamination({}, exam.id)).toEqual([]);
    expect(s.drafts.byExam.size).toBe(1);
    expect(s.documents.stored).toHaveLength(0);
    expect(s.alerts.events).toEqual([]);
    expect((await s.complete(ADMIN, exam.id, { generateReport: false }, CTX)).status).toBe("COMPLETED");
  });

  it("falha depois de o objeto estar escrito => o objeto vai para a outbox (discardStored)", async () => {
    const s = setup();
    const exam = await s.book();
    s.alerts.raiseExamEvent = () => Promise.reject(new Error("alertas em baixo"));
    await expect(s.complete(ADMIN, exam.id, { results: RESULTS }, CTX)).rejects.toThrow("alertas em baixo");
    expect(s.documents.discarded).toEqual(["documents/gen-1.pdf"]);
  });

  it("falha a guardar o documento gerado => a conclusão falha sem efeitos", async () => {
    const s = setup();
    const exam = await s.book();
    s.documents.failStore = new Error("storage");
    await expect(s.complete(ADMIN, exam.id, { results: RESULTS }, CTX)).rejects.toThrow("storage");
    expect((await s.examinationsRepo.findById({}, FAMILY_ID, MEMBER_ID, exam.id))?.status).toBe("SCHEDULED");
    expect(await s.examResultsRepo.listByExamination({}, exam.id)).toEqual([]);
  });

  it("o laudo é um instantâneo: o titular editar resultados depois não o recalcula (um só documento gerado)", async () => {
    const s = setup();
    const exam = await s.book();
    await s.complete(ADMIN, exam.id, { results: RESULTS }, CTX);
    expect(s.documents.stored).toHaveLength(1);
    expect(s.reportGenerator.requests).toHaveLength(1);
  });
});

describe("descarga do laudo pela clínica (BR-CLN-49)", () => {
  it("devolve só o laudo gerado, com auditoria sem dados; antes de COMPLETED, sem laudo ou apagado => NOT_FOUND; 30/min", async () => {
    const s = setup();
    const exam = await s.book();
    expect(await codeOf(s.download(ADMIN, exam.id, CTX))).toBe("NOT_FOUND"); // ainda SCHEDULED
    await s.complete(ADMIN, exam.id, { results: RESULTS }, CTX);
    const pdf = await s.download(DOCTOR, exam.id, CTX);
    expect(pdf.filename).toBe("laudo-20260201.pdf");
    expect(pdf.bytes.toString().startsWith("%PDF")).toBe(true);
    expect(s.audit.events.at(-1)).toMatchObject({ action: "EXAM_REPORT_DOWNLOAD", resourceType: "Document", metadata: { examinationId: exam.id } });
    expect(await codeOf(s.download(OTHER_DOCTOR, exam.id, CTX))).toBe("NOT_FOUND");
    expect(await codeOf(s.download(OTHER_CLINIC, exam.id, CTX))).toBe("NOT_FOUND");
    // O titular apagou o documento (D15): a cópia da clínica não é independente.
    s.documents.byResource.set(`EXAMINATION|${exam.id}`, []);
    expect(await codeOf(s.download(ADMIN, exam.id, CTX))).toBe("NOT_FOUND");
  });

  it("exame concluído sem laudo => NOT_FOUND; limite de 30 pedidos por minuto e por conta", async () => {
    const s = setup();
    const exam = await s.book();
    await s.complete(ADMIN, exam.id, { results: RESULTS, generateReport: false }, CTX);
    expect(await codeOf(s.download(ADMIN, exam.id, CTX))).toBe("NOT_FOUND");
    const other = await s.book("slot-2");
    await s.complete(ADMIN, other.id, { results: RESULTS }, CTX);
    for (let i = 0; i < 29; i += 1) await s.download(ADMIN, other.id, CTX);
    expect(await codeOf(s.download(ADMIN, other.id, CTX))).toBe("RATE_LIMITED");
  });
});
