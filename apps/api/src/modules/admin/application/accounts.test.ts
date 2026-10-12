import { describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import type { AuditEvent } from "../../audit/index.js";
import {
  createAdminListUsersUseCase,
  createAdminReactivateUserUseCase,
  createAdminSuspendUserUseCase,
  type AdminAccountsDeps,
} from "./accounts.js";

type Status = "PENDING_VERIFICATION" | "ACTIVE" | "SUSPENDED";
const ADMIN = { userId: "admin", platformAdmin: true };
const USER = { userId: "u1", platformAdmin: false };
const CTX = { requestId: "r1" };
const NOW = new Date("2026-10-12T10:00:00.000Z");

function setup() {
  const accounts = new Map<string, { id: string; email: string; status: Status; createdAt: Date; verified: boolean }>([
    ["a", { id: "a", email: "a@x.pt", status: "ACTIVE", createdAt: NOW, verified: true }],
    ["b", { id: "b", email: "b@x.pt", status: "PENDING_VERIFICATION", createdAt: NOW, verified: false }],
  ]);
  const events: AuditEvent[] = [];
  const deps: AdminAccountsDeps<null> = {
    clock: { now: () => NOW },
    withTransaction: (fn) => fn(null),
    audit: { record: (_trx, event) => { events.push(event); return Promise.resolve(); } },
    users: {
      byId: (_t, id) => Promise.resolve(accounts.get(id) ?? null),
      listAccounts: (_t, filter) => Promise.resolve({ items: [...accounts.values()].filter((u) => !filter.status || u.status === filter.status), nextCursor: null }),
      setSuspension: (_t, id, suspension) => {
        const user = accounts.get(id);
        if (user) user.status = suspension ? "SUSPENDED" : user.verified ? "ACTIVE" : "PENDING_VERIFICATION";
        return Promise.resolve(user);
      },
    },
  };
  return { deps, accounts, events };
}

describe("admin: contas (FR-ADM-01)", () => {
  it("só o Platform Admin pode listar, suspender e reativar", async () => {
    const { deps } = setup();
    await expect(createAdminListUsersUseCase(deps)(USER, {})).rejects.toThrow(ForbiddenError);
    await expect(createAdminSuspendUserUseCase(deps)(USER, "a", { reason: "x" }, CTX)).rejects.toThrow(ForbiddenError);
    await expect(createAdminReactivateUserUseCase(deps)(USER, "a", CTX)).rejects.toThrow(ForbiddenError);
  });

  it("lista só campos de conta (D4/R10), com filtro de estado", async () => {
    const { deps } = setup();
    const page = await createAdminListUsersUseCase(deps)(ADMIN, { status: "ACTIVE" });
    expect(page.items.map((u) => Object.keys(u).sort())).toEqual([["createdAt", "email", "id", "status"]]);
  });

  it("suspende com motivo, audita e é idempotente", async () => {
    const { deps, accounts, events } = setup();
    const suspend = createAdminSuspendUserUseCase(deps);
    await suspend(ADMIN, "a", { reason: "abuso" }, CTX);
    await suspend(ADMIN, "a", { reason: "abuso" }, CTX);
    expect(accounts.get("a")?.status).toBe("SUSPENDED");
    expect(events.map((e) => e.action)).toEqual(["ADMIN_USER_SUSPEND"]);
  });

  it("exige motivo, conta existente e não permite auto-suspensão", async () => {
    const { deps } = setup();
    const suspend = createAdminSuspendUserUseCase(deps);
    await expect(suspend(ADMIN, "a", { reason: "  " }, CTX)).rejects.toThrow(ValidationError);
    await expect(suspend(ADMIN, "zz", { reason: "x" }, CTX)).rejects.toThrow(NotFoundError);
    deps.users.byId = (_t, id) => Promise.resolve({ id, email: "x", status: "ACTIVE", createdAt: NOW });
    await expect(suspend(ADMIN, "admin", { reason: "x" }, CTX)).rejects.toThrow(ForbiddenError);
  });

  it("reativa e volta ao estado anterior; conta por verificar continua por verificar", async () => {
    const { deps, accounts, events } = setup();
    const suspend = createAdminSuspendUserUseCase(deps);
    const reactivate = createAdminReactivateUserUseCase(deps);
    await suspend(ADMIN, "a", { reason: "x" }, CTX);
    await suspend(ADMIN, "b", { reason: "x" }, CTX);
    await reactivate(ADMIN, "a", CTX);
    await reactivate(ADMIN, "b", CTX);
    expect(accounts.get("a")?.status).toBe("ACTIVE");
    expect(accounts.get("b")?.status).toBe("PENDING_VERIFICATION");
    expect(events.filter((e) => e.action === "ADMIN_USER_REACTIVATE")).toHaveLength(2);
  });
});
