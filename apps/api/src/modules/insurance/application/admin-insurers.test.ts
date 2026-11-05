// BR-ADM-05/06, BR-INS-06/10 (ADR-021/ADR-023): CRUD de seguradoras e conta raiz.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { verifyInsurancePassword } from "../domain/insurance-crypto.js";
import {
  createAdminCreateInsurerUseCase,
  createAdminInsurerRootAccountUseCase,
  createAdminListInsurersUseCase,
  createAdminSetInsurerStatusUseCase,
  createAdminUpdateInsurerUseCase,
} from "./admin-insurers.js";
import { createInsuranceFixtures } from "./fixtures.js";

const NOW = new Date("2026-11-05T10:00:00Z");
const ADMIN = { userId: "u-admin", platformAdmin: true };
const PLAIN = { userId: "u-plain", platformAdmin: false };
const CTX = { requestId: "r1" };

function setup() {
  const fx = createInsuranceFixtures(new FixedClock(NOW));
  return { fx, create: createAdminCreateInsurerUseCase(fx.deps) };
}

describe("seguradoras (admin)", () => {
  it("cria, lista e audita ADMIN_INSURER_CREATE (sem PII)", async () => {
    const { fx, create } = setup();
    const insurer = await create(ADMIN, { name: "  Vida SA ", taxId: " 500100200 " }, CTX);
    expect(insurer).toMatchObject({ name: "Vida SA", taxId: "500100200", status: "ACTIVE", createdBy: "u-admin" });
    expect(await createAdminListInsurersUseCase(fx.deps)(ADMIN)).toHaveLength(1);
    expect(fx.audit.events).toMatchObject([{ action: "ADMIN_INSURER_CREATE", actorType: "PLATFORM_ADMIN", resourceId: insurer.id, result: "SUCCESS" }]);
  });

  it("só PLATFORM_ADMIN (FORBIDDEN) em todas as operações, sem auditoria", async () => {
    const { fx, create } = setup();
    const i = await create(ADMIN, { name: "A", taxId: "1" }, CTX);
    fx.audit.events.length = 0;
    await expect(createAdminListInsurersUseCase(fx.deps)(PLAIN)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(create(PLAIN, { name: "B", taxId: "2" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createAdminUpdateInsurerUseCase(fx.deps)(PLAIN, i.id, { name: "x" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createAdminSetInsurerStatusUseCase(fx.deps)(PLAIN, i.id, { status: "SUSPENDED" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createAdminInsurerRootAccountUseCase(fx.deps)(PLAIN, i.id, { email: "a@b.pt" }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fx.audit.events).toHaveLength(0);
  });

  it.each([
    ["nome vazio", { name: "  ", taxId: "1" }],
    ["NIF vazio", { name: "A", taxId: " " }],
  ])("create: %s -> VALIDATION_ERROR", async (_n, input) => {
    const { create } = setup();
    await expect(create(ADMIN, input, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("NIF duplicado -> VALIDATION_ERROR (create e update); mesmo NIF no próprio registo é permitido", async () => {
    const { fx, create } = setup();
    const a = await create(ADMIN, { name: "A", taxId: "111" }, CTX);
    const b = await create(ADMIN, { name: "B", taxId: "222" }, CTX);
    await expect(create(ADMIN, { name: "C", taxId: "111" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const update = createAdminUpdateInsurerUseCase(fx.deps);
    await expect(update(ADMIN, b.id, { taxId: "111" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await update(ADMIN, a.id, { name: "A2", taxId: "111" }, CTX)).toMatchObject({ name: "A2", taxId: "111" });
    expect(fx.audit.events.at(-1)?.action).toBe("ADMIN_INSURER_UPDATE");
  });

  it("update/status/root-account de seguradora inexistente -> NOT_FOUND", async () => {
    const { fx } = setup();
    await expect(createAdminUpdateInsurerUseCase(fx.deps)(ADMIN, "nope", { name: "x" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createAdminSetInsurerStatusUseCase(fx.deps)(ADMIN, "nope", { status: "SUSPENDED" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createAdminInsurerRootAccountUseCase(fx.deps)(ADMIN, "nope", { email: "a@b.pt" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("suspender revoga as sessões de todas as contas da seguradora (BR-INS-10), reativar não; audita estado", async () => {
    const { fx, create } = setup();
    const a = await create(ADMIN, { name: "A", taxId: "1" }, CTX);
    const b = await create(ADMIN, { name: "B", taxId: "2" }, CTX);
    fx.insuranceAccountRepo.seed({ id: "acc-a", insurerId: a.id, email: "a@a.pt", passwordHash: "h", role: "INSURANCE_ADMIN", status: "ACTIVE", createdAt: NOW });
    fx.insuranceAccountRepo.seed({ id: "acc-b", insurerId: b.id, email: "b@b.pt", passwordHash: "h", role: "INSURANCE_ADMIN", status: "ACTIVE", createdAt: NOW });
    for (const [id, acc] of [["s-a", "acc-a"], ["s-b", "acc-b"]] as const) {
      await fx.insuranceSessionRepo.insert({}, { id, insuranceAccountId: acc, refreshTokenHash: id, tokenChainId: id, expiresAt: new Date("2027-01-01"), createdAt: NOW });
    }
    const setStatus = createAdminSetInsurerStatusUseCase(fx.deps);
    expect(await setStatus(ADMIN, a.id, { status: "SUSPENDED" }, CTX)).toMatchObject({ status: "SUSPENDED" });
    expect(fx.insuranceSessionRepo.sessions.get("s-a")?.revokedAt).toEqual(NOW);
    expect(fx.insuranceSessionRepo.sessions.get("s-b")?.revokedAt).toBeUndefined();
    expect(await setStatus(ADMIN, a.id, { status: "ACTIVE" }, CTX)).toMatchObject({ status: "ACTIVE" });
    expect(fx.audit.events.map((e) => [e.action, e.metadata])).toEqual([
      ["ADMIN_INSURER_CREATE", undefined],
      ["ADMIN_INSURER_CREATE", undefined],
      ["ADMIN_INSURER_STATUS", { status: "SUSPENDED" }],
      ["ADMIN_INSURER_STATUS", { status: "ACTIVE" }],
    ]);
  });
});

describe("root-account (BR-INS-06)", () => {
  it("cria INSURANCE_ADMIN, envia palavra-passe por e-mail e nunca a devolve; audita", async () => {
    const { fx, create } = setup();
    const insurer = await create(ADMIN, { name: "A", taxId: "1" }, CTX);
    const root = createAdminInsurerRootAccountUseCase(fx.deps);
    const account = await root(ADMIN, insurer.id, { email: " Root@Seg.PT " }, CTX);
    expect(account).toMatchObject({ insurerId: insurer.id, email: "root@seg.pt", role: "INSURANCE_ADMIN", status: "ACTIVE", createdByPlatformAdmin: "u-admin" });
    const mail = fx.insuranceMailer.lastSentTo("root@seg.pt");
    const password = mail?.text.split(": ")[1] ?? "";
    expect(password.length).toBeGreaterThanOrEqual(24);
    expect(await verifyInsurancePassword(account.passwordHash, password)).toBe(true);
    expect(JSON.stringify(fx.audit.events)).not.toContain(password);
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "ADMIN_INSURER_ROOT_ACCOUNT", resourceId: account.id, metadata: { reset: false } });
  });

  it("idempotente: repor substitui a credencial da MESMA conta, revoga sessões e nunca cria 2.ª", async () => {
    const { fx, create } = setup();
    const insurer = await create(ADMIN, { name: "A", taxId: "1" }, CTX);
    const root = createAdminInsurerRootAccountUseCase(fx.deps);
    const first = await root(ADMIN, insurer.id, { email: "root@seg.pt" }, CTX);
    await fx.insuranceSessionRepo.insert({}, { id: "s1", insuranceAccountId: first.id, refreshTokenHash: "x", tokenChainId: "c", expiresAt: new Date("2027-01-01"), createdAt: NOW });
    const oldHash = first.passwordHash;
    const second = await root(ADMIN, insurer.id, { email: "novo@seg.pt" }, CTX);
    expect(second.id).toBe(first.id);
    expect(second.email).toBe("novo@seg.pt");
    expect(second.passwordHash).not.toBe(oldHash);
    expect(fx.insuranceAccountRepo.byId.size).toBe(1);
    expect(fx.insuranceSessionRepo.sessions.get("s1")?.revokedAt).toEqual(NOW);
    expect(fx.audit.events.at(-1)?.metadata).toEqual({ reset: true });
  });

  it("e-mail de outra conta -> VALIDATION_ERROR, sem e-mail enviado", async () => {
    const { fx, create } = setup();
    const a = await create(ADMIN, { name: "A", taxId: "1" }, CTX);
    const b = await create(ADMIN, { name: "B", taxId: "2" }, CTX);
    const root = createAdminInsurerRootAccountUseCase(fx.deps);
    await root(ADMIN, a.id, { email: "x@seg.pt" }, CTX);
    fx.insuranceMailer.sent.length = 0;
    await expect(root(ADMIN, b.id, { email: "x@seg.pt" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fx.insuranceMailer.sent).toHaveLength(0);
  });

  it("falha do SMTP não falha o pedido (best effort) e regista aviso sem a palavra-passe", async () => {
    const { fx, create } = setup();
    const insurer = await create(ADMIN, { name: "A", taxId: "1" }, CTX);
    fx.insuranceMailer.failWith = new Error("smtp down");
    const account = await createAdminInsurerRootAccountUseCase(fx.deps)(ADMIN, insurer.id, { email: "r@seg.pt" }, CTX);
    expect(account.role).toBe("INSURANCE_ADMIN");
    expect(fx.insuranceLogger.warnings).toHaveLength(1);
    expect(JSON.stringify(fx.insuranceLogger.warnings)).not.toMatch(/palavra-passe de acesso/);
  });
});
