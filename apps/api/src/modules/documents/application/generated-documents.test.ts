// BR-CLN-49 (M15 T, ADR-027): laudo PDF gerado pelo servidor — nasce CLEAN sem quarentena nem ClamAV (exceção a BR-DOC-02),
// fora do limite de 5 PDF por exame, descarregável pelo paciente como qualquer documento de EXAMS (só com o exame COMPLETED,
// com download mediado e auditado), apagável pelo titular (D15), descarregável pela clínica só como laudo gerado.
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createDeleteClinicExamDocumentUseCase, createUploadClinicExamDocumentUseCase } from "./clinic-documents.js";
import { createDeleteDocumentUseCase } from "./delete-document.js";
import { createDownloadDocumentUseCase } from "./download-document.js";
import { createDocumentsFixtures, type DocumentsFixtures } from "./fixtures.js";
import { createDiscardStoredUseCase, createReadGeneratedExamReportUseCase, createStoreGeneratedUseCase, MAX_GENERATED_DOCUMENT_BYTES } from "./generated-documents.js";
import { createListDocumentsUseCase } from "./list-documents.js";

const PDF = Buffer.from("%PDF-1.4 laudo");
const USER = { userId: "user-1", platformAdmin: false };
const CONTEXT = { requestId: "req-1" };
const INPUT = { familyId: "family-1", memberId: "member-1", examinationId: "exam-1", originalName: "laudo-20260201.pdf", bytes: PDF, clinicAccountId: "acc-a" };

describe("storeGenerated", () => {
  let f: DocumentsFixtures;
  beforeEach(() => {
    f = createDocumentsFixtures(new FixedClock(new Date("2026-02-01T10:00:00Z")));
  });

  it("grava direto em documents/ (sem quarentena, sem scan), CLEAN, com checksum, da clínica e sem uploadedBy", async () => {
    const document = await createStoreGeneratedUseCase(f.deps)({}, INPUT);
    expect(document).toMatchObject({ scanStatus: "CLEAN", generatedBySystem: true, uploadedByClinic: true, uploadedByClinicAccountId: "acc-a", resourceType: "EXAMINATION", resourceId: "exam-1", mimeType: "application/pdf", sizeBytes: PDF.length });
    expect(document.uploadedBy).toBeUndefined();
    expect(document.storageKey).toBe(`documents/${document.id}.pdf`);
    expect(document.checksumSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(f.scanQueue.jobs).toEqual([]);
    expect(f.virusScanner.scanned).toEqual([]);
    expect((await f.storage.getObject(document.storageKey)).constructor.name).toBeDefined();
  });

  it("não conta para o limite de 5 PDF por exame nem bloqueia por quota", async () => {
    const store = createStoreGeneratedUseCase({ ...f.deps, maxFamilyStorageBytes: 1 });
    await store({}, INPUT);
    const upload = createUploadClinicExamDocumentUseCase(f.deps);
    for (let i = 0; i < 5; i += 1) {
      await upload({ clinicAccountId: "acc-a" }, { examinationId: "exam-1", file: { buffer: PDF, originalName: `${String(i)}.pdf` } }, () => Promise.resolve({ familyId: "family-1", memberId: "member-1" }), CONTEXT);
    }
    expect(await f.documentsRepo.countByResource({}, "family-1", "member-1", "EXAMINATION", "exam-1")).toBe(5);
    await expect(upload({ clinicAccountId: "acc-a" }, { examinationId: "exam-1", file: { buffer: PDF, originalName: "6.pdf" } }, () => Promise.resolve({ familyId: "family-1", memberId: "member-1" }), CONTEXT)).rejects.toMatchObject({ code: "DOCUMENT_LIMIT_EXCEEDED" });
  });

  it("tamanho 0 ou > 256 KB é recusado sem escrever objeto", async () => {
    const store = createStoreGeneratedUseCase(f.deps);
    await expect(store({}, { ...INPUT, bytes: Buffer.alloc(0) })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(store({}, { ...INPUT, bytes: Buffer.alloc(MAX_GENERATED_DOCUMENT_BYTES + 1, 1) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.documentsRepo.byId.size).toBe(0);
  });

  it("se o INSERT falha o objeto vai para a outbox file_deletions (em transação própria) e o erro propaga-se", async () => {
    f.documentsRepo.insert = () => Promise.reject(new Error("unique violada"));
    await expect(createStoreGeneratedUseCase(f.deps)({}, INPUT)).rejects.toThrow("unique violada");
    expect(f.fileDeletionsRepo.enqueued).toHaveLength(1);
    expect(f.fileDeletionsRepo.enqueued[0]).toMatch(/^documents\/.+\.pdf$/);
  });

  it("discardStored enfileira o objeto órfão", async () => {
    await createDiscardStoredUseCase(f.deps)("documents/x.pdf");
    expect(f.fileDeletionsRepo.enqueued).toEqual(["documents/x.pdf"]);
  });
});

describe("laudo gerado: paciente e clínica", () => {
  let f: DocumentsFixtures;
  let documentId: string;
  beforeEach(async () => {
    f = createDocumentsFixtures(new FixedClock(new Date("2026-02-01T10:00:00Z")));
    documentId = (await createStoreGeneratedUseCase(f.deps)({}, INPUT)).id;
  });

  it("o paciente só o vê e descarrega com o exame COMPLETED (BR-CLN-08); download mediado e auditado como DOCUMENT_DOWNLOAD", async () => {
    const list = createListDocumentsUseCase(f.deps);
    const download = createDownloadDocumentUseCase(f.deps);
    expect(await list(USER, "family-1", "member-1", { resourceType: "EXAMINATION", resourceId: "exam-1" }, CONTEXT)).toEqual([]);
    await expect(download(USER, "family-1", "member-1", documentId, CONTEXT)).rejects.toMatchObject({ code: "NOT_FOUND" });
    f.releaseGate.released.add("exam-1");
    expect(await list(USER, "family-1", "member-1", { resourceType: "EXAMINATION", resourceId: "exam-1" }, CONTEXT)).toHaveLength(1);
    const { document } = await download(USER, "family-1", "member-1", documentId, CONTEXT);
    expect(document.generatedBySystem).toBe(true);
    expect(f.audit.events.at(-1)).toMatchObject({ action: "DOCUMENT_DOWNLOAD", actorType: "USER", resourceId: documentId });
    expect(f.policy.calls.at(-1)).toMatchObject({ action: "READ", category: "EXAMS" });
  });

  it("o titular pode apagá-lo (D15) e a clínica deixa de o poder descarregar (NOT_FOUND, OP-47)", async () => {
    f.releaseGate.released.add("exam-1");
    const read = createReadGeneratedExamReportUseCase(f.deps);
    const found = await read({}, "family-1", "member-1", "exam-1");
    expect(found?.bytes.equals(PDF)).toBe(true);
    await createDeleteDocumentUseCase(f.deps)(USER, "family-1", "member-1", documentId, CONTEXT);
    expect(await read({}, "family-1", "member-1", "exam-1")).toBeNull();
    expect(f.fileDeletionsRepo.enqueued).toHaveLength(1);
  });

  it("a clínica só remove PDF carregados em exames SCHEDULED: o laudo existe só com o exame COMPLETED, que o resolver do exame recusa", async () => {
    const remove = createDeleteClinicExamDocumentUseCase(f.deps);
    // O resolver do exame (examinations) só deixa passar exames SCHEDULED; um laudo só existe em exames COMPLETED.
    await expect(remove({ clinicAccountId: "acc-a" }, { examinationId: "exam-1", documentId }, () => Promise.reject(new Error("CONFLICT")), CONTEXT)).rejects.toThrow("CONFLICT");
    expect(f.documentsRepo.byId.has(documentId)).toBe(true);
  });

  it("só o laudo do exame pedido (nunca PDF carregados nem de outro exame)", async () => {
    const read = createReadGeneratedExamReportUseCase(f.deps);
    expect(await read({}, "family-1", "member-1", "outro-exame")).toBeNull();
    expect(await read({}, "family-1", "outro-membro", "exam-1")).toBeNull();
  });
});
