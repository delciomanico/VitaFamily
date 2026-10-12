import { describe, expect, it } from "vitest";
import { InMemoryStorage } from "../../../platform/storage/index.js";
import { createDeleteFilesUseCase } from "./delete-files.js";
import { FakeDocumentsRepository, FakeFileDeletionsRepository } from "./fixtures.js";
import { createPurgeFilesUseCases } from "./purge-files.js";
import type { Document } from "../domain/document.js";

const trx = {};
const doc = (id: string, familyId: string, memberId: string): Document =>
  ({ id, familyId, memberId, storageKey: `key-${id}` }) as unknown as Document;

describe("purge de ficheiros (R2/R4/BR-ACC-07)", () => {
  function setup() {
    const documentsRepo = new FakeDocumentsRepository();
    const fileDeletionsRepo = new FakeFileDeletionsRepository();
    for (const d of [doc("a", "f1", "m1"), doc("b", "f1", "m2"), doc("c", "f2", "m3")]) documentsRepo.byId.set(d.id, d);
    return { documentsRepo, fileDeletionsRepo, purge: createPurgeFilesUseCases({ documentsRepo, fileDeletionsRepo }) };
  }

  it("enfileira só os ficheiros do membro", async () => {
    const { purge, fileDeletionsRepo } = setup();
    await purge.purgeMemberFiles(trx, "f1", "m1");
    expect(fileDeletionsRepo.enqueued).toEqual(["key-a"]);
  });

  it("enfileira todos os ficheiros da família e nenhum de outra", async () => {
    const { purge, fileDeletionsRepo } = setup();
    await purge.purgeFamilyFiles(trx, "f1");
    expect(fileDeletionsRepo.enqueued.sort()).toEqual(["key-a", "key-b"]);
  });
});

describe("job delete-files (ADR-011)", () => {
  it("apaga do armazenamento, marca como feito e repete falhas até ao limite", async () => {
    const fileDeletionsRepo = new FakeFileDeletionsRepository();
    await fileDeletionsRepo.enqueue(trx, "ok");
    await fileDeletionsRepo.enqueue(trx, "falha");
    const storage = new InMemoryStorage();
    await storage.putObject("ok", Buffer.from("x"), "text/plain");
    const realDelete = storage.deleteObject.bind(storage);
    storage.deleteObject = (key: string) => (key === "falha" ? Promise.reject(new Error("s3 down")) : realDelete(key));
    const run = createDeleteFilesUseCase({ fileDeletionsRepo, storage, clock: { now: () => new Date("2026-10-12T10:00:00Z") }, withTransaction: (fn) => fn(trx) });

    await expect(run()).resolves.toEqual({ deleted: 1, failed: 1 });
    expect(fileDeletionsRepo.rows.map((r) => [r.storageKey, Boolean(r.deletedAt), r.attempts])).toEqual([["ok", true, 0], ["falha", false, 1]]);
    expect(await storage.getObject("ok").then(() => true).catch(() => false)).toBe(false);
    await expect(run()).resolves.toEqual({ deleted: 0, failed: 1 });
  });
});
