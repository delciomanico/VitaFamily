import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { DataExport } from "../domain/export.js";
import { createDownloadExportUseCase, createExportBeforeRemovalUseCase, createGetExportUseCase, createRequestExportUseCase } from "./exports.js";
import type { ApiObject, ExportsRepository, ExportSources, LifecycleDeps, NewExportRecord } from "./ports.js";

const ME = { userId: "u1", platformAdmin: false };
const CTX = { requestId: "r1" };
let nowMs = Date.parse("2026-10-12T10:00:00.000Z");
const clock = { now: () => new Date(nowMs) };

class FakeRepo implements ExportsRepository<null> {
  readonly items = new Map<string, DataExport>();
  insert(_t: null, r: NewExportRecord) {
    const item: DataExport = { id: r.id, requestedBy: r.requestedBy, reason: r.reason, status: "PENDING", createdAt: r.createdAt, ...(r.familyId ? { familyId: r.familyId } : {}), ...(r.subjectMemberId ? { subjectMemberId: r.subjectMemberId } : {}) };
    this.items.set(item.id, item);
    return Promise.resolve(item);
  }
  findById(_t: null, id: string, by: string) {
    const item = this.items.get(id);
    return Promise.resolve(item?.requestedBy === by ? item : null);
  }
  countSince(_t: null, by: string, since: Date) {
    return Promise.resolve([...this.items.values()].filter((i) => i.requestedBy === by && i.createdAt > since).length);
  }
  markReady(_t: null, id: string, key: string, expiresAt: Date) {
    const item = this.items.get(id);
    if (item) Object.assign(item, { status: "READY", storageKey: key, expiresAt });
    return Promise.resolve();
  }
  listStorageKeysByUser() {
    return Promise.resolve([]);
  }
  markFailed(_t: null, id: string) {
    const item = this.items.get(id);
    if (item) item.status = "FAILED";
    return Promise.resolve();
  }
}

function setup(overrides: Partial<ExportSources> = {}, mailer?: LifecycleDeps<null>["mailer"]) {
  const repo = new FakeRepo();
  const stored = new Map<string, Buffer>();
  const events: AuditEvent[] = [];
  const errors: unknown[] = [];
  const notifyErrors: unknown[] = [];
  const sentMails: { to: string; subject: string; text: string }[] = [];
  const members: ApiObject[] = [
    { id: "m1", isSelf: true, guardianIds: [] },
    { id: "kid", isSelf: false, guardianIds: ["m1"] },
    { id: "other", isSelf: false, guardianIds: ["zz"] },
  ];
  const sources: ExportSources = {
    account: () => Promise.resolve({ name: "Eu", email: "eu@x.pt", birthDate: "1990-01-01", timezone: "Europe/Lisbon" }),
    listFamilies: () => Promise.resolve([{ id: "f1", name: "Família" }]),
    listMembers: () => Promise.resolve(members),
    bloodType: () => Promise.resolve("A_POS"),
    allergies: () => Promise.resolve([{ id: "al" }]),
    conditions: () => Promise.reject(new ForbiddenError()),
    prescriptions: () => Promise.resolve({ items: [{ id: "rx1" }], nextCursor: null }),
    plans: () => Promise.resolve({ items: [], nextCursor: null }),
    doses: () => Promise.resolve({ items: [], nextCursor: null }),
    appointments: () => Promise.resolve({ items: [], nextCursor: null }),
    examinations: () => Promise.resolve({ items: [], nextCursor: null }),
    documents: (_a, _f, _m, type) => Promise.resolve(type === "PRESCRIPTION" ? [{ id: "d1", originalName: "Receita nº1.pdf" }] : []),
    downloadDocument: () => Promise.resolve({ originalName: "x", stream: Readable.from([Buffer.from("%PDF-conteudo")]) }),
    ...overrides,
  };
  const deps: LifecycleDeps<null> = {
    exportsRepo: repo,
    sources,
    storage: {
      putObject: (key, body) => { stored.set(key, body); return Promise.resolve(); },
      getObject: (key) => Promise.resolve(Readable.from([stored.get(key) ?? Buffer.alloc(0)])),
      deleteObject: (key) => { stored.delete(key); return Promise.resolve(); },
    },
    mailer: mailer ?? { send: (email) => { sentMails.push(email); return Promise.resolve(); } },
    audit: { record: (_t, e) => { events.push(e); return Promise.resolve(); } },
    withTransaction: (fn) => fn(null),
    clock,
    onBuildError: (e) => errors.push(e),
    onNotifyError: (e) => notifyErrors.push(e),
    account: { verifyPassword: () => Promise.resolve(true), leaveFamily: () => Promise.resolve(), deleteFamily: () => Promise.resolve(), deleteAccount: () => Promise.resolve(), anonymizeAudit: () => Promise.resolve(0) },
  };
  return { deps, repo, stored, events, errors, notifyErrors, sentMails };
}

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

describe("exportação de dados (UC-ACC-06)", () => {
  it("responde PENDING, gera o pacote e fica READY com validade de 7 dias", async () => {
    const { deps, repo, stored, events } = setup();
    const view = await createRequestExportUseCase(deps)(ME, undefined, CTX);
    expect(view.status).toBe("PENDING");
    await flush();
    const item = repo.items.get(view.id);
    expect(item?.status).toBe("READY");
    expect(item?.expiresAt?.toISOString()).toBe("2026-10-19T10:00:00.000Z");
    const zip = stored.get(`exports/${view.id}.zip`);
    expect(zip?.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip?.includes(Buffer.from("documentos/f1/d1-Receita_n_1.pdf"))).toBe(true);
    expect(zip?.includes(Buffer.from("A_POS"))).toBe(true);
    expect(events.map((e) => e.action)).toEqual(["USER_EXPORT_REQUEST"]);
  });

  it("só exporta o que o pedinte pode ler (secção negada fica de fora)", async () => {
    const { deps, stored } = setup();
    const view = await createRequestExportUseCase(deps)(ME, undefined, CTX);
    await flush();
    const json = stored.get(`exports/${view.id}.zip`)?.toString("utf8") ?? "";
    expect(json).toContain('"allergies"');
    expect(json).not.toContain('"conditions"');
  });

  it("no máximo 3 pedidos por dia (N7)", async () => {
    const { deps } = setup();
    const request = createRequestExportUseCase(deps);
    for (let i = 0; i < 3; i++) await request(ME, undefined, CTX);
    await expect(request(ME, undefined, CTX)).rejects.toThrow(RateLimitedError);
    nowMs += 25 * 3_600_000;
    await expect(request(ME, undefined, CTX)).resolves.toBeDefined();
  });

  it("dependente: só o tutor pode pedir (P2)", async () => {
    const { deps } = setup();
    const request = createRequestExportUseCase(deps);
    await expect(request(ME, { familyId: "f1", memberId: "kid" }, CTX)).resolves.toBeDefined();
    await expect(request(ME, { familyId: "f1", memberId: "other" }, CTX)).rejects.toThrow(ForbiddenError);
    await expect(request(ME, { familyId: "f1", memberId: "nope" }, CTX)).rejects.toThrow(NotFoundError);
  });

  it("falha na geração → FAILED e erro registado", async () => {
    const { deps, repo, errors } = setup({ listFamilies: () => Promise.reject(new Error("boom")) });
    const view = await createRequestExportUseCase(deps)(ME, undefined, CTX);
    await flush();
    expect(repo.items.get(view.id)?.status).toBe("FAILED");
    expect(errors).toHaveLength(1);
  });

  it("os pedidos de outro utilizador não existem (404)", async () => {
    const { deps } = setup();
    const view = await createRequestExportUseCase(deps)(ME, undefined, CTX);
    await expect(createGetExportUseCase(deps)({ userId: "intruso", platformAdmin: false }, view.id)).rejects.toThrow(NotFoundError);
  });

  it("descarga: PENDING → EXPORT_NOT_READY; READY entrega e audita; expirada → 404", async () => {
    const { deps, events } = setup();
    const view = await createRequestExportUseCase(deps)(ME, undefined, CTX);
    const download = createDownloadExportUseCase(deps);
    await expect(download(ME, view.id, CTX)).rejects.toMatchObject({ code: "EXPORT_NOT_READY" });
    await flush();
    const { fileName, stream } = await download(ME, view.id, CTX);
    expect(fileName).toMatch(/\.zip$/);
    expect((await buffer(stream)).readUInt32LE(0)).toBe(0x04034b50);
    expect(events.map((e) => e.action)).toContain("USER_EXPORT_DOWNLOAD");
    nowMs += 8 * 86_400_000;
    await expect(download(ME, view.id, CTX)).rejects.toThrow(NotFoundError);
  });

  it("PENDING esquecido passa a FAILED ao consultar", async () => {
    const { deps, repo } = setup({ listFamilies: () => new Promise(() => undefined) });
    const view = await createRequestExportUseCase(deps)(ME, undefined, CTX);
    nowMs += 20 * 60_000;
    expect((await createGetExportUseCase(deps)(ME, view.id)).status).toBe("FAILED");
    expect(repo.items.get(view.id)?.status).toBe("FAILED");
  });
});

describe("pacote antes de sair/remover membro (BR-MEM-16/AC-MEM-07)", () => {
  it("avisa por e-mail depois de o pacote ficar pronto", async () => {
    const { deps, repo, sentMails } = setup();
    const exportId = await createExportBeforeRemovalUseCase(deps)({ userId: "u1", familyId: "f1", memberId: "m1", reason: "LEAVE_FAMILY", requestId: "r1" });
    expect(repo.items.get(exportId)?.status).toBe("READY");
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]).toMatchObject({ to: "eu@x.pt" });
  });

  it("falha no envio do e-mail não impede a saída/remoção (o pacote já está pronto)", async () => {
    const failingMailer: LifecycleDeps<null>["mailer"] = { send: () => Promise.reject(new Error("smtp down")) };
    const { deps, repo, notifyErrors } = setup({}, failingMailer);
    const exportId = await createExportBeforeRemovalUseCase(deps)({ userId: "u1", familyId: "f1", memberId: "m1", reason: "LEAVE_FAMILY", requestId: "r1" });
    expect(repo.items.get(exportId)?.status).toBe("READY");
    expect(notifyErrors).toHaveLength(1);
  });
});
