import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import type { ClinicAccount } from "../domain/clinic-account.js";
import {
  createAdminListClinicAccountsUseCase,
  createAdminReactivateClinicAccountUseCase,
  createAdminSuspendClinicAccountUseCase,
} from "./admin-clinic-accounts.js";
import { createClinicsFixtures } from "./fixtures.js";

const NOW = new Date("2026-10-12T10:00:00Z");
const CTX = { requestId: "req-1" };
const ADMIN = { userId: "platform-admin", platformAdmin: true };
const NOT_ADMIN = { userId: "u", platformAdmin: false };
const CLINIC_A = "clinic-a";
const CLINIC_B = "clinic-b";

function account(id: string, clinicId: string, role: ClinicAccount["role"], status: ClinicAccount["status"] = "ACTIVE"): ClinicAccount {
  return { id, clinicId, email: `${id}@clinica.pt`, passwordHash: "hash", role, status, createdAt: NOW };
}

async function setup() {
  const fx = createClinicsFixtures(new FixedClock(NOW));
  for (const [id, type] of [[CLINIC_A, "PARTNER"], [CLINIC_B, "PARTNER"], ["private", "PRIVATE"]] as const) {
    await fx.clinicsRepo.insert({}, { id, type, name: id, createdAt: NOW, ...(type === "PRIVATE" ? { familyId: "f" } : {}) });
  }
  fx.clinicAccountRepo.seed(account("admin-a", CLINIC_A, "CLINIC_ADMIN"));
  fx.clinicAccountRepo.seed(account("mgr-a", CLINIC_A, "CLINIC_MANAGER"));
  fx.clinicAccountRepo.seed(account("admin-b", CLINIC_B, "CLINIC_ADMIN"));
  return fx;
}

describe("admin: contas do portal da clínica (BR-ADM-03/04)", () => {
  it("só o Platform Admin", async () => {
    const fx = await setup();
    await expect(createAdminListClinicAccountsUseCase(fx.deps)(NOT_ADMIN, CLINIC_A)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createAdminSuspendClinicAccountUseCase(fx.deps)(NOT_ADMIN, CLINIC_A, "mgr-a", { reason: "x" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createAdminReactivateClinicAccountUseCase(fx.deps)(NOT_ADMIN, CLINIC_A, "mgr-a", CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lista só as contas da clínica, com lastLoginAt e sem palavra-passe", async () => {
    const fx = await setup();
    const login = new Date("2026-10-11T08:00:00Z");
    fx.clinicAccountRepo.lastLogins.set("admin-a", login);
    const list = await createAdminListClinicAccountsUseCase(fx.deps)(ADMIN, CLINIC_A);
    expect(list.map((a) => a.id).sort()).toEqual(["admin-a", "mgr-a"]);
    expect(list.find((a) => a.id === "admin-a")).toEqual({
      id: "admin-a", clinicId: CLINIC_A, email: "admin-a@clinica.pt", role: "CLINIC_ADMIN", status: "ACTIVE", createdAt: NOW, lastLoginAt: login, suspendedAt: null,
    });
    expect(list.find((a) => a.id === "mgr-a")?.lastLoginAt).toBeNull();
    expect(JSON.stringify(list)).not.toContain("hash");
  });

  it("clínica inexistente ou privada -> NOT_FOUND", async () => {
    const fx = await setup();
    await expect(createAdminListClinicAccountsUseCase(fx.deps)(ADMIN, "nope")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createAdminListClinicAccountsUseCase(fx.deps)(ADMIN, "private")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("suspender exige motivo, revoga as sessões de imediato, audita sem motivo/PII e é idempotente", async () => {
    const fx = await setup();
    for (const [id, chain] of [["s1", "c1"], ["s2", "c2"]] as const) {
      await fx.clinicSessionRepo.insert({}, { id, clinicAccountId: "mgr-a", refreshTokenHash: id, tokenChainId: chain, expiresAt: new Date("2027-01-01"), createdAt: NOW });
    }
    await fx.clinicSessionRepo.insert({}, { id: "other", clinicAccountId: "admin-a", refreshTokenHash: "o", tokenChainId: "c3", expiresAt: new Date("2027-01-01"), createdAt: NOW });
    const suspend = createAdminSuspendClinicAccountUseCase(fx.deps);

    await expect(suspend(ADMIN, CLINIC_A, "mgr-a", { reason: "  " }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await suspend(ADMIN, CLINIC_A, "mgr-a", { reason: "Pedido do cliente joao@x.pt" }, CTX);
    await suspend(ADMIN, CLINIC_A, "mgr-a", { reason: "again" }, CTX);

    expect(fx.clinicAccountRepo.byId.get("mgr-a")).toMatchObject({ status: "SUSPENDED", suspendedAt: NOW });
    expect(fx.clinicSessionRepo.sessions.get("s1")?.revokedAt).toEqual(NOW);
    expect(fx.clinicSessionRepo.sessions.get("s2")?.revokedAt).toEqual(NOW);
    expect(fx.clinicSessionRepo.sessions.get("other")?.revokedAt).toBeUndefined();
    expect(fx.audit.events).toHaveLength(1);
    expect(fx.audit.events[0]).toMatchObject({ action: "ADMIN_CLINIC_ACCOUNT_SUSPEND", actorType: "PLATFORM_ADMIN", actorUserId: "platform-admin", resourceId: "mgr-a", metadata: { clinicId: CLINIC_A, role: "CLINIC_MANAGER" } });
    expect(JSON.stringify(fx.audit.events)).not.toContain("joao");
  });

  it("conta de outra clínica ou inexistente -> NOT_FOUND igual (sem enumeração)", async () => {
    const fx = await setup();
    const suspend = createAdminSuspendClinicAccountUseCase(fx.deps);
    await expect(suspend(ADMIN, CLINIC_A, "admin-b", { reason: "x" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(suspend(ADMIN, CLINIC_A, "ghost", { reason: "x" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createAdminReactivateClinicAccountUseCase(fx.deps)(ADMIN, CLINIC_A, "admin-b", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fx.clinicAccountRepo.byId.get("admin-b")?.status).toBe("ACTIVE");
  });

  it("reativa e audita; reativar CLINIC_ADMIN com outro ativo -> CONFLICT", async () => {
    const fx = await setup();
    const suspend = createAdminSuspendClinicAccountUseCase(fx.deps);
    const reactivate = createAdminReactivateClinicAccountUseCase(fx.deps);

    await suspend(ADMIN, CLINIC_A, "mgr-a", { reason: "x" }, CTX);
    await reactivate(ADMIN, CLINIC_A, "mgr-a", CTX);
    expect(fx.clinicAccountRepo.byId.get("mgr-a")?.status).toBe("ACTIVE");
    expect(fx.audit.events.map((e) => e.action)).toEqual(["ADMIN_CLINIC_ACCOUNT_SUSPEND", "ADMIN_CLINIC_ACCOUNT_REACTIVATE"]);

    // Admin suspenso e reposição da raiz cria outro ativo => reativar o antigo é CONFLICT.
    await suspend(ADMIN, CLINIC_A, "admin-a", { reason: "x" }, CTX);
    fx.clinicAccountRepo.seed(account("admin-a2", CLINIC_A, "CLINIC_ADMIN"));
    await expect(reactivate(ADMIN, CLINIC_A, "admin-a", CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fx.clinicAccountRepo.byId.get("admin-a")?.status).toBe("SUSPENDED");
  });

  it("reativar o CLINIC_ADMIN quando não há outro ativo funciona", async () => {
    const fx = await setup();
    await createAdminSuspendClinicAccountUseCase(fx.deps)(ADMIN, CLINIC_A, "admin-a", { reason: "x" }, CTX);
    await createAdminReactivateClinicAccountUseCase(fx.deps)(ADMIN, CLINIC_A, "admin-a", CTX);
    expect(fx.clinicAccountRepo.byId.get("admin-a")?.status).toBe("ACTIVE");
  });
});
