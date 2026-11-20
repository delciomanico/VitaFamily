// Fonte opcional `recordShares` do pacote de exportação (MK4 S8, BR-MKT-76, UC-MKT-58, TC-MKT-131): entra no pacote do membro quando a leitura
// devolve itens; fica de fora quando não existe, quando vem vazia ou quando a leitura nega (ForbiddenError) — nunca rebenta.
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../../platform/errors/index.js";
import { buildExportPackage } from "./build-package.js";
import type { ApiObject, ExportSources } from "./ports.js";

const ACTOR = { userId: "u1", platformAdmin: false };
const CTX = { requestId: "r1" };
const NOW = new Date("2026-11-16T10:00:00.000Z");
const SHARE: ApiObject = {
  id: "s1",
  professional: "Dra. Teste",
  categories: ["MEDICATION"],
  validity: "H24",
  viewOnce: false,
  status: "ACTIVE",
  expiresAt: "2026-11-17T10:00:00.000Z",
  revokedAt: null,
  consumedAt: null,
  createdAt: "2026-11-16T09:00:00.000Z",
  views: [{ viewNo: 1, viewedAt: "2026-11-16T09:30:00.000Z", categories: ["MEDICATION"] }],
};

function sources(overrides: Partial<ExportSources> = {}): ExportSources {
  const page = () => Promise.resolve({ items: [], nextCursor: null });
  return {
    account: () => Promise.resolve({ name: "Eu", email: "eu@x.ao", birthDate: "1990-01-01", timezone: "Africa/Luanda" }),
    listFamilies: () => Promise.resolve([{ id: "f1", name: "Família" }]),
    listMembers: () => Promise.resolve([{ id: "m1", isSelf: true }]),
    bloodType: () => Promise.resolve("O+"),
    allergies: () => Promise.resolve([]),
    conditions: () => Promise.resolve([]),
    prescriptions: page,
    plans: page,
    doses: page,
    appointments: page,
    examinations: page,
    documents: () => Promise.resolve([]),
    downloadDocument: () => Promise.reject(new ForbiddenError()),
    ...overrides,
  };
}

/** Lê o `dados.json` do pacote pelo cabeçalho local do ZIP (entrada "stored": dados logo após o cabeçalho). */
async function dataOf(src: ExportSources): Promise<Record<string, unknown>> {
  const zip = await buildExportPackage(src, ACTOR, {}, NOW, CTX);
  expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  const size = zip.readUInt32LE(18);
  const nameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const start = 30 + nameLength + extraLength;
  expect(zip.subarray(30, 30 + nameLength).toString("utf8")).toBe("dados.json");
  return JSON.parse(zip.subarray(start, start + size).toString("utf8")) as Record<string, unknown>;
}

function memberOf(data: Record<string, unknown>): Record<string, unknown> {
  const families = data.families as Record<string, unknown>[];
  return families[0] ?? {};
}

describe("exportação: fonte opcional `recordShares` (MK4 S8, BR-MKT-76)", () => {
  it("quando a fonte existe e devolve itens, o pacote do membro contém `recordShares`", async () => {
    const reads: string[] = [];
    const data = await dataOf(
      sources({
        recordShares: (actor, familyId, memberId) => {
          reads.push(`${actor.userId}:${familyId}:${memberId}`);
          return Promise.resolve([SHARE]);
        },
      }),
    );
    expect(reads).toEqual(["u1:f1:m1"]);
    expect(memberOf(data).recordShares).toEqual([SHARE]);
  });

  it("quando a fonte não existe, a secção é omitida e a exportação conclui", async () => {
    const data = await dataOf(sources());
    expect(memberOf(data)).not.toHaveProperty("recordShares");
    expect(memberOf(data)).toHaveProperty("documents");
  });

  it("quando a leitura lança ForbiddenError, a secção é omitida sem rebentar o pacote", async () => {
    const data = await dataOf(sources({ recordShares: () => Promise.reject(new ForbiddenError()) }));
    expect(memberOf(data)).not.toHaveProperty("recordShares");
    expect(memberOf(data)).toHaveProperty("documents");
  });

  it("quando a leitura devolve lista vazia, a secção fica de fora (sem partilhas, sem chave)", async () => {
    const data = await dataOf(sources({ recordShares: () => Promise.resolve([]) }));
    expect(memberOf(data)).not.toHaveProperty("recordShares");
  });

  it("um erro que não é de permissão continua a propagar-se (não se esconde como 'sem acesso')", async () => {
    await expect(buildExportPackage(sources({ recordShares: () => Promise.reject(new Error("bd em baixo")) }), ACTOR, {}, NOW, CTX)).rejects.toThrow("bd em baixo");
  });
});
