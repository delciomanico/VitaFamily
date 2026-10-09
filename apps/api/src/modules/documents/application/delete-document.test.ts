// AC-DOC-05 (D15): eliminar via outbox — enfileira file_deletions ANTES de apagar a linha.
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Document } from "../domain/document.js";
import { createDeleteDocumentUseCase } from "./delete-document.js";
import { createDocumentsFixtures, type DocumentsFixtures } from "./fixtures.js";

const ACTOR = { userId: "user-1", platformAdmin: false };
const CONTEXT = { requestId: "req-1" };

function doc(): Document {
  return {
    id: "doc-1",
    familyId: "family-1",
    memberId: "member-1",
    resourceType: "PRESCRIPTION",
    resourceId: "prescription-1",
    storageKey: "documents/doc-1.pdf",
    originalName: "r.pdf",
    mimeType: "application/pdf",
    sizeBytes: 10,
    checksumSha256: "abc",
    scanStatus: "CLEAN",
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
}

describe("deleteDocument", () => {
  let fixtures: DocumentsFixtures;

  beforeEach(() => {
    fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
  });

  it("NOT_FOUND quando o documento não existe", async () => {
    const useCase = createDeleteDocumentUseCase(fixtures.deps);
    await expect(useCase(ACTOR, "family-1", "member-1", "nope", CONTEXT)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("enfileira file_deletions e apaga a linha, auditando DOCUMENT_DELETE", async () => {
    fixtures.documentsRepo.seed(doc());
    const useCase = createDeleteDocumentUseCase(fixtures.deps);
    await useCase(ACTOR, "family-1", "member-1", "doc-1", CONTEXT);

    expect(fixtures.fileDeletionsRepo.enqueued).toEqual(["documents/doc-1.pdf"]);
    expect(fixtures.documentsRepo.byId.has("doc-1")).toBe(false);
    expect(fixtures.audit.events).toMatchObject([{ action: "DOCUMENT_DELETE", resourceId: "doc-1", result: "SUCCESS" }]);
  });

  it("autoriza WRITE(categoria do recurso) antes de apagar", async () => {
    fixtures.documentsRepo.seed(doc());
    fixtures.policy.denyWith = new Error("sem permissão");
    const useCase = createDeleteDocumentUseCase(fixtures.deps);
    await expect(useCase(ACTOR, "family-1", "member-1", "doc-1", CONTEXT)).rejects.toThrow("sem permissão");
    expect(fixtures.fileDeletionsRepo.enqueued).toHaveLength(0);
  });
});
