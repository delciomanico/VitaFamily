// BR-CLN-08 (D19, AC-EXM-06): PDF emitido pela clínica — só PDF, limites sem revelar a quota da família,
// quarentena + ClamAV mantidos, autorização do portal (resolveTarget, nunca AccessPolicy) e visibilidade
// ao paciente só com o exame COMPLETED; ficheiro infetado nunca é descarregável.
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Document } from "../domain/document.js";
import { createDeleteClinicExamDocumentUseCase, createUploadClinicExamDocumentUseCase } from "./clinic-documents.js";
import { createDeleteDocumentUseCase } from "./delete-document.js";
import { createDownloadDocumentUseCase } from "./download-document.js";
import { createDocumentsFixtures, type DocumentsFixtures } from "./fixtures.js";
import { createGetDocumentUseCase } from "./get-document.js";
import { createListDocumentsUseCase } from "./list-documents.js";
import { createScanDocumentUseCase } from "./scan-document.js";

const PDF = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const CLINIC = { clinicAccountId: "acc-a" };
const USER = { userId: "user-1", platformAdmin: false };
const CONTEXT = { requestId: "req-1" };
const TARGET = { familyId: "family-1", memberId: "member-1" };
const resolveTarget = () => Promise.resolve(TARGET);

describe("uploadClinicExamDocument", () => {
  let fixtures: DocumentsFixtures;

  beforeEach(() => {
    fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
  });

  it("nasce PENDING em quarentena, com uploadedByClinicAccountId, enfileira o scan e audita sem família", async () => {
    const upload = createUploadClinicExamDocumentUseCase(fixtures.deps);
    const document = await upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "r.pdf" } }, resolveTarget, CONTEXT);

    expect(document).toMatchObject({ scanStatus: "PENDING", resourceType: "EXAMINATION", resourceId: "exam-1", uploadedByClinic: true, uploadedByClinicAccountId: "acc-a" });
    expect(document.uploadedBy).toBeUndefined();
    expect(document.storageKey.startsWith("quarantine/")).toBe(true);
    expect(fixtures.scanQueue.jobs).toEqual([{ documentId: document.id, familyId: "family-1" }]);
    const event = fixtures.audit.events[0];
    expect(event).toMatchObject({ action: "EXAM_DOCUMENT_UPLOAD", actorType: "CLINIC_ACCOUNT", actorClinicAccountId: "acc-a", result: "SUCCESS" });
    expect(event?.familyId).toBeUndefined();
    expect(fixtures.policy.calls).toEqual([]); // portal: nunca AccessPolicy
  });

  it("só PDF (verificado pelo conteúdo): JPG -> FILE_TYPE_NOT_ALLOWED; .pdf que é executável também", async () => {
    const upload = createUploadClinicExamDocumentUseCase(fixtures.deps);
    await expect(upload(CLINIC, { examinationId: "exam-1", file: { buffer: JPG, originalName: "r.jpg" } }, resolveTarget, CONTEXT)).rejects.toMatchObject({ code: "FILE_TYPE_NOT_ALLOWED" });
    await expect(upload(CLINIC, { examinationId: "exam-1", file: { buffer: Buffer.from("MZ\u0090\u0000"), originalName: "r.pdf" } }, resolveTarget, CONTEXT)).rejects.toMatchObject({ code: "FILE_TYPE_NOT_ALLOWED" });
    expect(fixtures.documentsRepo.byId.size).toBe(0);
  });

  it("> limite de tamanho -> FILE_TOO_LARGE", async () => {
    const upload = createUploadClinicExamDocumentUseCase({ ...fixtures.deps, maxFileSizeBytes: 4 });
    await expect(upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "r.pdf" } }, resolveTarget, CONTEXT)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("6.º ficheiro do exame -> DOCUMENT_LIMIT_EXCEEDED", async () => {
    const upload = createUploadClinicExamDocumentUseCase(fixtures.deps);
    for (let i = 0; i < 5; i++) {
      await upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: `${String(i)}.pdf` } }, resolveTarget, CONTEXT);
    }
    await expect(upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "6.pdf" } }, resolveTarget, CONTEXT)).rejects.toMatchObject({ code: "DOCUMENT_LIMIT_EXCEEDED" });
  });

  it("quota da família excedida -> CONFLICT genérico (nunca STORAGE_QUOTA_EXCEEDED nem o valor da quota)", async () => {
    const upload = createUploadClinicExamDocumentUseCase({ ...fixtures.deps, maxFamilyStorageBytes: PDF.length });
    await upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "a.pdf" } }, resolveTarget, CONTEXT);
    const error = (await upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "b.pdf" } }, resolveTarget, CONTEXT).catch((e: unknown) => e)) as Error;
    expect(error).toMatchObject({ code: "CONFLICT" });
    expect(error.message).not.toMatch(/quota|MB|armazenamento/i);
  });

  it("se a verificação do exame falha (outra clínica / não SCHEDULED) nada é gravado", async () => {
    const upload = createUploadClinicExamDocumentUseCase(fixtures.deps);
    const denied = () => Promise.reject(new Error("NOT_FOUND"));
    await expect(upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "a.pdf" } }, denied, CONTEXT)).rejects.toThrow("NOT_FOUND");
    expect(fixtures.documentsRepo.byId.size).toBe(0);
    expect(fixtures.scanQueue.jobs).toEqual([]);
  });

  it("limita a 20 uploads/hora por conta de clínica (RATE_LIMITED)", async () => {
    const upload = createUploadClinicExamDocumentUseCase({ ...fixtures.deps, maxFilesPerResource: 100 });
    for (let i = 0; i < 20; i++) {
      await upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "a.pdf" } }, resolveTarget, CONTEXT);
    }
    await expect(upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "a.pdf" } }, resolveTarget, CONTEXT)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});

describe("deleteClinicExamDocument", () => {
  let fixtures: DocumentsFixtures;

  beforeEach(() => {
    fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
  });

  it("remove o PDF da clínica pela outbox de ficheiros e audita; não toca em documentos da família", async () => {
    const upload = createUploadClinicExamDocumentUseCase(fixtures.deps);
    const mine = await upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "a.pdf" } }, resolveTarget, CONTEXT);
    const familyDoc: Document = { ...mine, id: "family-doc", uploadedBy: "user-1", uploadedByClinic: false };
    delete familyDoc.uploadedByClinicAccountId;
    fixtures.documentsRepo.seed(familyDoc);
    const remove = createDeleteClinicExamDocumentUseCase(fixtures.deps);

    await expect(remove(CLINIC, { examinationId: "exam-1", documentId: "family-doc" }, resolveTarget, CONTEXT)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(remove(CLINIC, { examinationId: "outro-exame", documentId: mine.id }, resolveTarget, CONTEXT)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await remove(CLINIC, { examinationId: "exam-1", documentId: mine.id }, resolveTarget, CONTEXT);

    expect(fixtures.documentsRepo.byId.has(mine.id)).toBe(false);
    expect(fixtures.documentsRepo.byId.has("family-doc")).toBe(true);
    expect(fixtures.fileDeletionsRepo.enqueued).toEqual([mine.storageKey]);
    expect(fixtures.audit.events.at(-1)).toMatchObject({ action: "DOCUMENT_DELETE", actorType: "CLINIC_ACCOUNT" });
  });
});

describe("visibilidade ao paciente (BR-CLN-08/BR-DOC-04)", () => {
  let fixtures: DocumentsFixtures;
  let documentId: string;

  beforeEach(async () => {
    fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
    const upload = createUploadClinicExamDocumentUseCase(fixtures.deps);
    const document = await upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "a.pdf" } }, resolveTarget, CONTEXT);
    documentId = document.id;
    // O worker de antivírus (ClamAV) liberta o ficheiro da quarentena.
    await createScanDocumentUseCase(fixtures.deps)({ documentId, familyId: "family-1" });
    expect(fixtures.documentsRepo.byId.get(documentId)?.scanStatus).toBe("CLEAN");
  });

  it("exame ainda não COMPLETED: listar omite, obter/descarregar/apagar dão NOT_FOUND", async () => {
    const list = createListDocumentsUseCase(fixtures.deps);
    expect(await list(USER, "family-1", "member-1", { resourceType: "EXAMINATION", resourceId: "exam-1" })).toEqual([]);
    await expect(createGetDocumentUseCase(fixtures.deps)(USER, "family-1", "member-1", documentId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createDownloadDocumentUseCase(fixtures.deps)(USER, "family-1", "member-1", documentId, CONTEXT)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createDeleteDocumentUseCase(fixtures.deps)(USER, "family-1", "member-1", documentId, CONTEXT)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fixtures.audit.events.some((e) => e.action === "DOCUMENT_DOWNLOAD")).toBe(false);
  });

  it("exame COMPLETED: o paciente lista e descarrega (autorizado por READ(EXAMS) e auditado)", async () => {
    fixtures.releaseGate.released.add("exam-1");
    const list = createListDocumentsUseCase(fixtures.deps);
    expect(await list(USER, "family-1", "member-1", { resourceType: "EXAMINATION", resourceId: "exam-1" })).toHaveLength(1);
    const { stream } = await createDownloadDocumentUseCase(fixtures.deps)(USER, "family-1", "member-1", documentId, CONTEXT);
    expect(stream).toBeDefined();
    expect(fixtures.policy.calls.at(-1)).toMatchObject({ action: "READ", category: "EXAMS" });
    expect(fixtures.audit.events.at(-1)).toMatchObject({ action: "DOCUMENT_DOWNLOAD", actorType: "USER" });
  });

  it("BR-CLN-08 (0022): conta da clínica removida (autor a null) não liberta o PDF antes de COMPLETED; liberta com COMPLETED", async () => {
    // `ON DELETE SET NULL` anula o autor, mas a marca permanente `uploadedByClinic` mantém-se.
    const stored = fixtures.documentsRepo.byId.get(documentId);
    if (!stored) throw new Error("documento em falta");
    delete stored.uploadedByClinicAccountId;
    expect(stored.uploadedByClinic).toBe(true);
    const list = createListDocumentsUseCase(fixtures.deps);
    expect(await list(USER, "family-1", "member-1", { resourceType: "EXAMINATION", resourceId: "exam-1" })).toEqual([]);
    await expect(createGetDocumentUseCase(fixtures.deps)(USER, "family-1", "member-1", documentId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    fixtures.releaseGate.released.add("exam-1");
    expect(await list(USER, "family-1", "member-1", { resourceType: "EXAMINATION", resourceId: "exam-1" })).toHaveLength(1);
  });

  it("sem porta de libertação ligada o PDF da clínica nunca é libertado (falha fechada)", async () => {
    const withoutGate = { ...fixtures.deps };
    delete withoutGate.releaseGate;
    await expect(createGetDocumentUseCase(withoutGate)(USER, "family-1", "member-1", documentId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("PDF infetado da clínica (AC-DOC-02, AC-EXM-06)", () => {
  it("o antivírus apaga ficheiro e registo, audita DOCUMENT_SCAN_INFECTED e nunca fica descarregável, mesmo com o exame COMPLETED", async () => {
    const fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
    const upload = createUploadClinicExamDocumentUseCase(fixtures.deps);
    const document = await upload(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "eicar.pdf" } }, resolveTarget, CONTEXT);
    fixtures.virusScanner.result = "INFECTED";
    await createScanDocumentUseCase(fixtures.deps)({ documentId: document.id, familyId: "family-1" });
    fixtures.releaseGate.released.add("exam-1");

    expect(fixtures.documentsRepo.byId.has(document.id)).toBe(false);
    await expect(fixtures.storage.getObject(document.storageKey)).rejects.toThrow();
    expect(fixtures.audit.events.map((e) => e.action)).toContain("DOCUMENT_SCAN_INFECTED");
    await expect(createDownloadDocumentUseCase(fixtures.deps)(USER, "family-1", "member-1", document.id, CONTEXT)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await createListDocumentsUseCase(fixtures.deps)(USER, "family-1", "member-1", { resourceType: "EXAMINATION", resourceId: "exam-1" })).toEqual([]);
  });

  it("um PDF ainda PENDING não é descarregável mesmo com o exame COMPLETED (DOCUMENT_NOT_AVAILABLE)", async () => {
    const fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
    const document = await createUploadClinicExamDocumentUseCase(fixtures.deps)(CLINIC, { examinationId: "exam-1", file: { buffer: PDF, originalName: "a.pdf" } }, resolveTarget, CONTEXT);
    fixtures.releaseGate.released.add("exam-1");
    await expect(createDownloadDocumentUseCase(fixtures.deps)(USER, "family-1", "member-1", document.id, CONTEXT)).rejects.toMatchObject({ code: "DOCUMENT_NOT_AVAILABLE" });
  });
});
