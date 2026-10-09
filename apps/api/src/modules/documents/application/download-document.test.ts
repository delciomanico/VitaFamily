// AC-DOC-01 (só CLEAN pode ser descarregado), AC-DOC-04 (negado sem permissão; auditado quando
// permitido, Cache-Control fica a cargo do router — ver interface/router.ts).
import { beforeEach, describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { Document } from "../domain/document.js";
import { createDocumentsFixtures, type DocumentsFixtures } from "./fixtures.js";
import { createDownloadDocumentUseCase } from "./download-document.js";

const ACTOR = { userId: "user-1", platformAdmin: false };
const CONTEXT = { requestId: "req-1" };

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

async function readAll(stream: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

describe("downloadDocument", () => {
  let fixtures: DocumentsFixtures;

  beforeEach(() => {
    fixtures = createDocumentsFixtures(new FixedClock(new Date("2026-01-01T10:00:00Z")));
  });

  it("NOT_FOUND quando o documento não existe", async () => {
    const useCase = createDownloadDocumentUseCase(fixtures.deps);
    await expect(useCase(ACTOR, "family-1", "member-1", "nope", CONTEXT)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("DOCUMENT_NOT_AVAILABLE enquanto scanStatus != CLEAN (AC-DOC-01)", async () => {
    fixtures.documentsRepo.seed(doc({ scanStatus: "PENDING" }));
    const useCase = createDownloadDocumentUseCase(fixtures.deps);
    await expect(useCase(ACTOR, "family-1", "member-1", "doc-1", CONTEXT)).rejects.toMatchObject({
      code: "DOCUMENT_NOT_AVAILABLE",
    });
  });

  it("nega sem permissão e não audita (AC-DOC-04)", async () => {
    fixtures.documentsRepo.seed(doc());
    fixtures.policy.denyWith = new Error("sem permissão");
    const useCase = createDownloadDocumentUseCase(fixtures.deps);
    await expect(useCase(ACTOR, "family-1", "member-1", "doc-1", CONTEXT)).rejects.toThrow("sem permissão");
    expect(fixtures.audit.events).toHaveLength(0);
  });

  it("entrega o stream e audita DOCUMENT_DOWNLOAD quando permitido (AC-DOC-04)", async () => {
    fixtures.documentsRepo.seed(doc());
    await fixtures.storage.putObject("documents/doc-1.pdf", Buffer.from("conteúdo"), "application/pdf");

    const useCase = createDownloadDocumentUseCase(fixtures.deps);
    const result = await useCase(ACTOR, "family-1", "member-1", "doc-1", CONTEXT);

    expect(await readAll(result.stream)).toBe("conteúdo");
    expect(fixtures.audit.events).toMatchObject([{ action: "DOCUMENT_DOWNLOAD", resourceId: "doc-1", result: "SUCCESS" }]);
  });
});
