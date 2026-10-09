// Porta pública pensada para M6/M7 (prompt do módulo): `listForResource`/`deleteAllForResource`
// chamados pelo próprio caso de uso de eliminação de recurso (prescriptions/examinations), na
// transação deles — aqui só se testa com o fake `trx` partilhado (mesmo critério de
// `health-records`).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Document } from "../domain/document.js";
import { createDeleteAllForResourceUseCase, createListForResourceUseCase } from "./for-resource.js";
import { createDocumentsFixtures, type DocumentsFixtures } from "./fixtures.js";

function doc(overrides: Partial<Document> = {}): Document {
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
    ...overrides,
  };
}

describe("listForResource / deleteAllForResource (API pública para M6/M7)", () => {
  let fixtures: DocumentsFixtures;

  beforeEach(() => {
    fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
  });

  it("listForResource devolve os documentos do recurso, sem decidir autorização (cabe ao chamador)", async () => {
    fixtures.documentsRepo.seed(doc({ id: "doc-1" }));
    fixtures.documentsRepo.seed(doc({ id: "doc-2", resourceId: "prescription-2" }));

    const listForResource = createListForResourceUseCase(fixtures.deps);
    const result = await listForResource(fixtures.deps.db, "family-1", "member-1", "PRESCRIPTION", "prescription-1");

    expect(result.map((d) => d.id)).toEqual(["doc-1"]);
  });

  it("deleteAllForResource enfileira file_deletions para cada documento e apaga as linhas", async () => {
    fixtures.documentsRepo.seed(doc({ id: "doc-1", storageKey: "documents/doc-1.pdf" }));
    fixtures.documentsRepo.seed(doc({ id: "doc-2", storageKey: "documents/doc-2.pdf" }));
    fixtures.documentsRepo.seed(doc({ id: "doc-3", resourceId: "prescription-2", storageKey: "documents/doc-3.pdf" }));

    const deleteAllForResource = createDeleteAllForResourceUseCase(fixtures.deps);
    await deleteAllForResource(fixtures.deps.db, "family-1", "member-1", "PRESCRIPTION", "prescription-1");

    expect(fixtures.fileDeletionsRepo.enqueued.sort()).toEqual(["documents/doc-1.pdf", "documents/doc-2.pdf"]);
    expect(fixtures.documentsRepo.byId.has("doc-1")).toBe(false);
    expect(fixtures.documentsRepo.byId.has("doc-2")).toBe(false);
    expect(fixtures.documentsRepo.byId.has("doc-3")).toBe(true);
  });
});
