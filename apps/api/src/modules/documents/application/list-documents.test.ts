import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Document } from "../domain/document.js";
import { createDocumentsFixtures, type DocumentsFixtures } from "./fixtures.js";
import { createListDocumentsUseCase } from "./list-documents.js";

const ACTOR = { userId: "user-1", platformAdmin: false };

function doc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    familyId: "family-1",
    memberId: "member-1",
    resourceType: "PRESCRIPTION",
    resourceId: "prescription-1",
    storageKey: "quarantine/doc-1.pdf",
    originalName: "r.pdf",
    mimeType: "application/pdf",
    sizeBytes: 10,
    checksumSha256: "abc",
    scanStatus: "CLEAN",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("listDocuments", () => {
  let fixtures: DocumentsFixtures;

  beforeEach(() => {
    fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
  });

  it("exige resourceType e resourceId (VALIDATION_ERROR)", async () => {
    const useCase = createListDocumentsUseCase(fixtures.deps);
    await expect(useCase(ACTOR, "family-1", "member-1", {})).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("devolve só os documentos do recurso pedido, autorizando READ pela categoria certa", async () => {
    fixtures.documentsRepo.seed(doc({ id: "doc-1" }));
    fixtures.documentsRepo.seed(doc({ id: "doc-2", resourceId: "prescription-2" }));

    const useCase = createListDocumentsUseCase(fixtures.deps);
    const result = await useCase(ACTOR, "family-1", "member-1", {
      resourceType: "PRESCRIPTION",
      resourceId: "prescription-1",
    });

    expect(result.map((d) => d.id)).toEqual(["doc-1"]);
    expect(fixtures.policy.calls[0]).toMatchObject({ action: "READ", category: "MEDICATION" });
  });

  it("propaga o DENY da política", async () => {
    fixtures.policy.denyWith = new Error("sem permissão");
    const useCase = createListDocumentsUseCase(fixtures.deps);
    await expect(
      useCase(ACTOR, "family-1", "member-1", { resourceType: "EXAMINATION", resourceId: "exam-1" }),
    ).rejects.toThrow("sem permissão");
  });
});
