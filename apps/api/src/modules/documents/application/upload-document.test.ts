// AC-DOC-01 (nasce PENDING), AC-DOC-03 (tipo/tamanho/limites), BR-DOC-01..03.
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import type { Document } from "../domain/document.js";
import { createDocumentsFixtures, type DocumentsFixtures } from "./fixtures.js";
import { createUploadDocumentUseCase, type UploadDocumentInput } from "./upload-document.js";

const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const ACTOR = { userId: "user-1", platformAdmin: false };
const CONTEXT = { requestId: "req-1" };

function input(overrides: Partial<UploadDocumentInput> = {}): UploadDocumentInput {
  return {
    resourceType: "PRESCRIPTION",
    resourceId: "prescription-1",
    file: { buffer: PDF_BYTES, originalName: "receita.pdf" },
    ...overrides,
  };
}

describe("uploadDocument", () => {
  let fixtures: DocumentsFixtures;

  beforeEach(() => {
    fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
  });

  it("AC-DOC-01: nasce PENDING, grava no storage e enfileira o scan", async () => {
    const useCase = createUploadDocumentUseCase(fixtures.deps);
    const document: Document = await useCase(ACTOR, "family-1", "member-1", input(), CONTEXT);

    expect(document.scanStatus).toBe("PENDING");
    expect(document.mimeType).toBe("application/pdf");
    expect(document.storageKey.startsWith("quarantine/")).toBe(true);
    await expect(fixtures.storage.getObject(document.storageKey)).resolves.toBeDefined();
    expect(fixtures.scanQueue.jobs).toEqual([{ documentId: document.id, familyId: "family-1" }]);
  });

  it("audita DOCUMENT_UPLOAD com resultado SUCCESS", async () => {
    const useCase = createUploadDocumentUseCase(fixtures.deps);
    const document = await useCase(ACTOR, "family-1", "member-1", input(), CONTEXT);

    expect(fixtures.audit.events).toHaveLength(1);
    expect(fixtures.audit.events[0]).toMatchObject({
      action: "DOCUMENT_UPLOAD",
      resourceId: document.id,
      result: "SUCCESS",
    });
  });

  it("pede CREATE/MEDICATION para PRESCRIPTION e CREATE/EXAMS para EXAMINATION", async () => {
    const useCase = createUploadDocumentUseCase(fixtures.deps);
    await useCase(ACTOR, "family-1", "member-1", input({ resourceType: "PRESCRIPTION" }), CONTEXT);
    await useCase(ACTOR, "family-1", "member-1", input({ resourceType: "EXAMINATION", resourceId: "exam-1" }), CONTEXT);

    expect(fixtures.policy.calls[0]).toMatchObject({ action: "CREATE", category: "MEDICATION" });
    expect(fixtures.policy.calls[1]).toMatchObject({ action: "CREATE", category: "EXAMS" });
  });

  it("AC-DOC-03: recusa tipo não suportado (FILE_TYPE_NOT_ALLOWED)", async () => {
    const useCase = createUploadDocumentUseCase(fixtures.deps);
    const exe = Buffer.from([0x4d, 0x5a, 0x90, 0x00]);
    await expect(useCase(ACTOR, "family-1", "member-1", input({ file: { buffer: exe, originalName: "x.pdf" } }), CONTEXT)).rejects.toMatchObject(
      { code: "FILE_TYPE_NOT_ALLOWED" },
    );
  });

  it("AC-DOC-03: recusa ficheiro acima de 10 MB (FILE_TOO_LARGE)", async () => {
    const useCase = createUploadDocumentUseCase(fixtures.deps);
    const big = Buffer.concat([PDF_BYTES, Buffer.alloc(10 * 1024 * 1024)]);
    await expect(useCase(ACTOR, "family-1", "member-1", input({ file: { buffer: big, originalName: "big.pdf" } }), CONTEXT)).rejects.toMatchObject(
      { code: "FILE_TOO_LARGE" },
    );
  });

  it("AC-DOC-03: recusa o 6.º ficheiro do mesmo recurso (DOCUMENT_LIMIT_EXCEEDED)", async () => {
    const useCase = createUploadDocumentUseCase(fixtures.deps);
    for (let i = 0; i < 5; i++) {
      await useCase(ACTOR, "family-1", "member-1", input(), CONTEXT);
    }
    await expect(useCase(ACTOR, "family-1", "member-1", input(), CONTEXT)).rejects.toMatchObject(
      { code: "DOCUMENT_LIMIT_EXCEEDED" },
    );
  });

  it("AC-DOC-03: recusa quando a quota de 100 MB da família seria excedida (STORAGE_QUOTA_EXCEEDED)", async () => {
    fixtures.deps.maxFamilyStorageBytes = PDF_BYTES.length; // quota já esgotada pelo 1º ficheiro
    const useCase = createUploadDocumentUseCase(fixtures.deps);
    await useCase(ACTOR, "family-1", "member-1", input(), CONTEXT);
    await expect(useCase(ACTOR, "family-1", "member-1", input({ resourceId: "prescription-2" }), CONTEXT)).rejects.toMatchObject(
      { code: "STORAGE_QUOTA_EXCEEDED" },
    );
  });

  it("limita a 20 uploads/hora por utilizador (RATE_LIMITED)", async () => {
    const useCase = createUploadDocumentUseCase(fixtures.deps);
    for (let i = 0; i < 20; i++) {
      await useCase(ACTOR, "family-1", "member-1", input({ resourceId: `prescription-${i.toString()}` }), CONTEXT);
    }
    await expect(useCase(ACTOR, "family-1", "member-1", input({ resourceId: "prescription-20" }), CONTEXT)).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it("propaga o DENY da política de acesso", async () => {
    fixtures.policy.denyWith = new Error("sem permissão");
    const useCase = createUploadDocumentUseCase(fixtures.deps);
    await expect(useCase(ACTOR, "family-1", "member-1", input(), CONTEXT)).rejects.toThrow("sem permissão");
  });

  it("exige resourceId", async () => {
    const useCase = createUploadDocumentUseCase(fixtures.deps);
    await expect(useCase(ACTOR, "family-1", "member-1", input({ resourceId: "" }), CONTEXT)).rejects.toBeInstanceOf(ValidationError);
  });
});
