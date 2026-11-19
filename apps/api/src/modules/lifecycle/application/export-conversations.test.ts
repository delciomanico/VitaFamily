// Fonte opcional `conversations` do pacote de exportação (MK2 S10, BR-MKT-45, TC-MKT-67): entra no pacote do membro quando a leitura
// devolve itens; fica de fora quando não existe, quando vem vazia ou quando a leitura nega (ForbiddenError) — nunca rebenta.
import { describe, expect, it } from "vitest";
import { ForbiddenError } from "../../../platform/errors/index.js";
import { buildExportPackage } from "./build-package.js";
import type { ApiObject, ExportSources } from "./ports.js";

const ACTOR = { userId: "u1", platformAdmin: false };
const CTX = { requestId: "r1" };
const NOW = new Date("2026-11-16T10:00:00.000Z");
const CONVERSATION: ApiObject = { id: "c1", participantLabel: "Dra. Teste", professional: { displayName: "Dra. Teste", city: "Luanda" }, status: "OPEN", messages: [{ seq: 1, side: "FAMILY", text: "olá" }] };

function sources(overrides: Partial<ExportSources> = {}): ExportSources {
  const page = () => Promise.resolve({ items: [], nextCursor: null });
  return {
    account: () => Promise.resolve({ name: "Eu", email: "eu@x.ao", birthDate: "1990-01-01", timezone: "Africa/Luanda" }),
    listFamilies: () => Promise.resolve([{ id: "f1", name: "Família" }]),
    listMembers: () => Promise.resolve([{ id: "m1", isSelf: true }]),
    bloodType: () => Promise.resolve(null),
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

describe("exportação: fonte opcional `conversations` (MK2 S10, BR-MKT-45)", () => {
  it("quando a fonte existe e devolve itens, o pacote do membro contém `conversations`", async () => {
    const reads: string[] = [];
    const data = await dataOf(
      sources({
        conversations: (actor, familyId, memberId) => {
          reads.push(`${actor.userId}:${familyId}:${memberId}`);
          return Promise.resolve([CONVERSATION]);
        },
      }),
    );
    expect(reads).toEqual(["u1:f1:m1"]);
    expect(memberOf(data).conversations).toEqual([CONVERSATION]);
  });

  it("quando a fonte não existe, a secção é omitida e a exportação conclui", async () => {
    const data = await dataOf(sources());
    expect(memberOf(data)).not.toHaveProperty("conversations");
    expect(memberOf(data)).toHaveProperty("documents");
  });

  it("quando a leitura lança ForbiddenError, a secção é omitida sem rebentar o pacote", async () => {
    const data = await dataOf(sources({ conversations: () => Promise.reject(new ForbiddenError()) }));
    expect(memberOf(data)).not.toHaveProperty("conversations");
    expect(memberOf(data)).toHaveProperty("documents");
  });

  it("quando a leitura devolve lista vazia, a secção fica de fora (sem conversas, sem chave)", async () => {
    const data = await dataOf(sources({ conversations: () => Promise.resolve([]) }));
    expect(memberOf(data)).not.toHaveProperty("conversations");
  });

  it("um erro que não é de permissão continua a propagar-se (não se esconde como 'sem acesso')", async () => {
    await expect(buildExportPackage(sources({ conversations: () => Promise.reject(new Error("bd em baixo")) }), ACTOR, {}, NOW, CTX)).rejects.toThrow("bd em baixo");
  });
});
