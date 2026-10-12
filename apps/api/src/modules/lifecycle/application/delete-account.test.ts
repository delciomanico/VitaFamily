import { describe, expect, it } from "vitest";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { AuditEvent } from "../../audit/index.js";
import { createDeleteAccountUseCase } from "./delete-account.js";
import type { ApiObject, LifecycleDeps } from "./ports.js";

const ME = { userId: "u1", platformAdmin: false };
const CTX = { requestId: "r1" };

interface Family { id: string; members: ApiObject[] }

const self = (over: ApiObject = {}): ApiObject => ({ id: "m1", isSelf: true, role: "FAMILY_ADMIN", isDependent: false, guardianIds: [], ...over });

function setup(families: Family[], passwordOk = true) {
  const calls: string[] = [];
  const events: AuditEvent[] = [];
  const storage = new Map<string, number>([["exports/e1.zip", 1]]);
  const deps = {
    exportsRepo: { listStorageKeysByUser: () => Promise.resolve(["exports/e1.zip"]) },
    storage: { deleteObject: (k: string) => { storage.delete(k); calls.push(`storage:${k}`); return Promise.resolve(); } },
    sources: {
      listFamilies: () => Promise.resolve(families.map((f) => ({ id: f.id }))),
      listMembers: (_u: string, familyId: string) => Promise.resolve(families.find((f) => f.id === familyId)?.members ?? []),
    },
    account: {
      verifyPassword: () => Promise.resolve(passwordOk),
      leaveFamily: (_u: string, f: string) => { calls.push(`leave:${f}`); return Promise.resolve(); },
      deleteFamily: (_u: string, f: string) => { calls.push(`deleteFamily:${f}`); return Promise.resolve(); },
      deleteAccount: () => { calls.push("deleteAccount"); return Promise.resolve(); },
      anonymizeAudit: () => { calls.push("anonymize"); return Promise.resolve(3); },
    },
    audit: { record: (_t: null, e: AuditEvent) => { events.push(e); return Promise.resolve(); } },
    withTransaction: <T>(fn: (trx: null) => Promise<T>) => fn(null),
    clock: { now: () => new Date("2026-10-12T10:00:00Z") },
  } as unknown as LifecycleDeps<null>;
  return { run: createDeleteAccountUseCase(deps), calls, events, storage };
}

describe("eliminar conta (UC-ACC-05)", () => {
  it("palavra-passe errada → 401 e nada é apagado", async () => {
    const { run, calls } = setup([{ id: "f1", members: [self()] }], false);
    await expect(run(ME, "x", CTX)).rejects.toThrow(UnauthenticatedError);
    expect(calls).toEqual([]);
  });

  it("única pessoa da família → elimina a família (R2); noutras sai (R4); depois conta, pacotes e auditoria", async () => {
    const { run, calls, events, storage } = setup([
      { id: "f1", members: [self()] },
      { id: "f2", members: [self({ role: "FAMILY_MEMBER" }), { id: "m9", isSelf: false, role: "FAMILY_ADMIN", guardianIds: [] }] },
    ]);
    await run(ME, "ok", CTX);
    expect(calls).toEqual(["deleteFamily:f1", "leave:f2", "deleteAccount", "storage:exports/e1.zip", "anonymize"]);
    expect(events.map((e) => e.action)).toEqual(["USER_DELETE"]);
    expect(storage.size).toBe(0);
  });

  it.each([
    ["único Admin com outros membros", [self(), { id: "m2", isSelf: false, role: "FAMILY_MEMBER", guardianIds: [] }]],
    ["único tutor de um dependente", [self({ role: "FAMILY_MEMBER" }), { id: "k", isSelf: false, role: null, isDependent: true, guardianIds: ["m1"] }, { id: "a2", isSelf: false, role: "FAMILY_ADMIN", guardianIds: [] }]],
    ["dependente com conta", [self({ role: "FAMILY_MEMBER", isDependent: true }), { id: "a2", isSelf: false, role: "FAMILY_ADMIN", guardianIds: [] }]],
  ])("bloqueada: %s — e não apaga nada (nem as outras famílias)", async (_name, members) => {
    const { run, calls } = setup([{ id: "f0", members: [self()] }, { id: "f1", members }]);
    await expect(run(ME, "ok", CTX)).rejects.toMatchObject({ code: "ACCOUNT_DELETION_BLOCKED" });
    expect(calls).toEqual([]);
  });

  it("tutor com outro tutor pode sair", async () => {
    const { run, calls } = setup([{ id: "f1", members: [self({ role: "FAMILY_MEMBER" }), { id: "k", isSelf: false, isDependent: true, guardianIds: ["m1", "m7"] }, { id: "a2", isSelf: false, role: "FAMILY_ADMIN", guardianIds: [] }] }]);
    await run(ME, "ok", CTX);
    expect(calls).toContain("leave:f1");
  });
});
