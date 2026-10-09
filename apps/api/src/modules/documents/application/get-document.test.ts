import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Document } from "../domain/document.js";
import { createDocumentsFixtures, type DocumentsFixtures } from "./fixtures.js";
import { createGetDocumentUseCase } from "./get-document.js";

const ACTOR = { userId: "user-1", platformAdmin: false };

function doc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    familyId: "family-1",
    memberId: "member-1",
    resourceType: "EXAMINATION",
    resourceId: "exam-1",
    storageKey: "documents/doc-1.pdf",
    originalName: "exame.pdf",
    mimeType: "application/pdf",
    sizeBytes: 10,
    checksumSha256: "abc",
    scanStatus: "CLEAN",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("getDocument", () => {
  let fixtures: DocumentsFixtures;

  beforeEach(() => {
    fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
  });

  it("devolve NOT_FOUND quando o documento não existe nesta família/membro", async () => {
    const useCase = createGetDocumentUseCase(fixtures.deps);
    await expect(useCase(ACTOR, "family-1", "member-1", "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("não chega a chamar a política quando o documento não existe (errors.md regra 2)", async () => {
    const useCase = createGetDocumentUseCase(fixtures.deps);
    await expect(useCase(ACTOR, "family-1", "member-1", "nope")).rejects.toBeDefined();
    expect(fixtures.policy.calls).toHaveLength(0);
  });

  it("autoriza READ/EXAMS (derivado de resourceType=EXAMINATION) e devolve o documento", async () => {
    fixtures.documentsRepo.seed(doc());
    const useCase = createGetDocumentUseCase(fixtures.deps);
    const result = await useCase(ACTOR, "family-1", "member-1", "doc-1");

    expect(result.id).toBe("doc-1");
    expect(fixtures.policy.calls[0]).toMatchObject({ action: "READ", category: "EXAMS" });
  });
});
