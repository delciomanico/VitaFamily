// AC-DOC-01 (PENDING -> CLEAN), AC-DOC-02 (EICAR/INFECTED -> ficheiro apagado, upload recusado,
// auditado DOCUMENT_SCAN_INFECTED).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Document } from "../domain/document.js";
import { createDocumentsFixtures, type DocumentsFixtures } from "./fixtures.js";
import { createScanDocumentUseCase } from "./scan-document.js";

const PDF_BYTES = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

function pendingDoc(overrides: Partial<Document> = {}): Document {
  return {
    id: "doc-1",
    familyId: "family-1",
    memberId: "member-1",
    resourceType: "PRESCRIPTION",
    resourceId: "prescription-1",
    storageKey: "quarantine/doc-1.pdf",
    originalName: "r.pdf",
    mimeType: "application/pdf",
    sizeBytes: PDF_BYTES.length,
    checksumSha256: "abc",
    scanStatus: "PENDING",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("scanDocument", () => {
  let fixtures: DocumentsFixtures;

  beforeEach(async () => {
    fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
    fixtures.documentsRepo.seed(pendingDoc());
    await fixtures.storage.putObject("quarantine/doc-1.pdf", PDF_BYTES, "application/pdf");
  });

  it("AC-DOC-01: scan limpo move para a chave final e marca CLEAN", async () => {
    fixtures.virusScanner.result = "CLEAN";
    const useCase = createScanDocumentUseCase(fixtures.deps);
    await useCase({ documentId: "doc-1", familyId: "family-1" });

    const updated = fixtures.documentsRepo.byId.get("doc-1");
    expect(updated?.scanStatus).toBe("CLEAN");
    expect(updated?.storageKey).toBe("documents/doc-1.pdf");
    await expect(fixtures.storage.getObject("documents/doc-1.pdf")).resolves.toBeDefined();
    await expect(fixtures.storage.getObject("quarantine/doc-1.pdf")).rejects.toThrow();
    expect(fixtures.audit.events).toMatchObject([{ action: "DOCUMENT_SCAN_CLEAN", actorType: "SYSTEM", result: "SUCCESS" }]);
  });

  it("AC-DOC-02: scan positivo apaga o ficheiro, apaga a linha e audita DOCUMENT_SCAN_INFECTED", async () => {
    fixtures.virusScanner.result = "INFECTED";
    const useCase = createScanDocumentUseCase(fixtures.deps);
    await useCase({ documentId: "doc-1", familyId: "family-1" });

    expect(fixtures.documentsRepo.byId.has("doc-1")).toBe(false);
    await expect(fixtures.storage.getObject("quarantine/doc-1.pdf")).rejects.toThrow();
    expect(fixtures.audit.events).toMatchObject([{ action: "DOCUMENT_SCAN_INFECTED", actorType: "SYSTEM", result: "SUCCESS" }]);
  });

  it("idempotente: não faz nada se o documento já não está PENDING", async () => {
    fixtures.documentsRepo.seed(pendingDoc({ scanStatus: "CLEAN", storageKey: "documents/doc-1.pdf" }));
    const useCase = createScanDocumentUseCase(fixtures.deps);
    await useCase({ documentId: "doc-1", familyId: "family-1" });

    expect(fixtures.audit.events).toHaveLength(0);
    expect(fixtures.virusScanner.scanned).toHaveLength(0);
  });

  it("idempotente: não faz nada se o documento já foi apagado", async () => {
    const useCase = createScanDocumentUseCase(fixtures.deps);
    await useCase({ documentId: "doc-inexistente", familyId: "family-1" });
    expect(fixtures.audit.events).toHaveLength(0);
  });
});
