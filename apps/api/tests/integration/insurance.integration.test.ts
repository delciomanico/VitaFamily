// Integração real (testcontainers + PostgreSQL 16) da Fase 4a (ADR-021/ADR-023): migração 0024,
// seguradoras (NIF único), conta raiz idempotente (índice único parcial), login/refresh/logout sobre
// insurance_sessions, suspensão da seguradora (BR-INS-10), agentes isolados por seguradora e
// auditoria com actor_type=INSURANCE_ACCOUNT / actor_insurance_account_id.
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import type { Logger } from "../../src/platform/logger/index.js";
import { KyselyAuditRepository } from "../../src/modules/audit/infrastructure/repo.js";
import {
  createAdminCreateInsurerUseCase,
  createAdminInsurerRootAccountUseCase,
  createAdminSetInsurerStatusUseCase,
  createAdminUpdateInsurerUseCase,
} from "../../src/modules/insurance/application/admin-insurers.js";
import { FakeInsuranceLogger, FakeInsuranceMailer } from "../../src/modules/insurance/application/fixtures.js";
import { createInsuranceLoginUseCase } from "../../src/modules/insurance/application/insurance-login.js";
import { createInsuranceLogoutUseCase } from "../../src/modules/insurance/application/insurance-logout.js";
import { createInsuranceRefreshUseCase } from "../../src/modules/insurance/application/insurance-refresh.js";
import { createCreateInsuranceAgentUseCase, createListInsuranceAgentsUseCase, createRemoveInsuranceAgentUseCase } from "../../src/modules/insurance/application/manage-insurance-agents.js";
import type { CachedInsuranceAccountState, InsuranceDeps } from "../../src/modules/insurance/application/ports.js";
import { InsuranceInMemoryRateLimiter } from "../../src/modules/insurance/domain/insurance-rate-limiter.js";
import { InsuranceTtlCache } from "../../src/modules/insurance/domain/insurance-ttl-cache.js";
import { KyselyInsuranceAccountRepository, KyselyInsuranceSessionRepository, KyselyInsurersRepository } from "../../src/modules/insurance/infrastructure/repo.js";

describe("integração: seguradoras e portal da seguradora (Fase 4a)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  const clock = new FixedClock(new Date("2026-11-05T10:00:00Z"));
  const platformAdminId = randomUUID();
  const actor = { userId: platformAdminId, platformAdmin: true };
  const ctx = { requestId: "r1", ip: "203.0.113.9" };
  const mailer = new FakeInsuranceMailer();
  const ids = { a: "", b: "" };

  function deps(): InsuranceDeps<Kysely<Database>> {
    return {
      insurersRepo: new KyselyInsurersRepository(),
      insuranceAccountRepo: new KyselyInsuranceAccountRepository(),
      insuranceSessionRepo: new KyselyInsuranceSessionRepository(),
      audit: new KyselyAuditRepository(),
      db,
      withTransaction: (fn) => withTransaction(db, fn),
      clock,
      insuranceMailer: mailer,
      logger: new FakeInsuranceLogger() as unknown as Logger,
      insuranceRateLimiter: new InsuranceInMemoryRateLimiter(clock),
      insuranceSigningKeys: [{ kid: "t", secret: new TextEncoder().encode("a".repeat(32)) }],
      insuranceAccessTtlSeconds: 900,
      insuranceRefreshTtlMs: 30 * 24 * 60 * 60 * 1000,
      accountStateCache: new InsuranceTtlCache<CachedInsuranceAccountState>(clock, 60_000),
    };
  }
  const must = async (d: InsuranceDeps<Kysely<Database>>, email: string) => {
    const account = await d.insuranceAccountRepo.findByEmail(db, email);
    if (!account) throw new Error(`conta ${email} inexistente`);
    return account;
  };
  const passwordOf = (to: string) => mailer.lastSentTo(to)?.text.split(": ")[1] ?? "";

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);
    await runMigrations(pool, defaultMigrationsDir());
    await pool.query(
      "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, platform_role, email_verified_at, terms_accepted_version, terms_accepted_at) VALUES ($1,'admin@vita.pt','h','Admin','1990-01-01','Europe/Lisbon','ACTIVE','PLATFORM_ADMIN',now(),'1',now())",
      [platformAdminId],
    );
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("cria seguradoras; NIF único (caso de uso e restrição da BD); edição; auditoria com actor_type PLATFORM_ADMIN", async () => {
    const d = deps();
    const create = createAdminCreateInsurerUseCase(d);
    const a = await create(actor, { name: "Seg A", taxId: "500000001" }, ctx);
    const b = await create(actor, { name: "Seg B", taxId: "500000002" }, ctx);
    ids.a = a.id;
    ids.b = b.id;
    await expect(create(actor, { name: "X", taxId: "500000001" }, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(pool.query("INSERT INTO insurer_accounts (name, tax_id) VALUES ('Y','500000001')")).rejects.toMatchObject({ code: "23505" });
    const update = createAdminUpdateInsurerUseCase(d);
    await expect(update(actor, b.id, { taxId: "500000001" }, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(await update(actor, a.id, { name: "Seg A+" }, ctx)).toMatchObject({ name: "Seg A+", taxId: "500000001", status: "ACTIVE" });
    expect((await new KyselyInsurersRepository().list(db)).map((i) => i.name)).toEqual(["Seg A+", "Seg B"]);
    const audit = await pool.query("SELECT action, actor_type::text, actor_user_id FROM audit_logs WHERE resource_type='Insurer' ORDER BY id");
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual(["ADMIN_INSURER_CREATE", "ADMIN_INSURER_CREATE", "ADMIN_INSURER_UPDATE"]);
    expect(audit.rows.every((r: { actor_type: string; actor_user_id: string }) => r.actor_type === "PLATFORM_ADMIN" && r.actor_user_id === platformAdminId)).toBe(true);
  });

  it("conta raiz: idempotente (mesma linha), palavra-passe só no e-mail; índice parcial impede 2.º INSURANCE_ADMIN ativo", async () => {
    const root = createAdminInsurerRootAccountUseCase(deps());
    const first = await root(actor, ids.a, { email: "Root@A.pt" }, ctx);
    const pw1 = passwordOf("root@a.pt");
    const second = await root(actor, ids.a, { email: "root@a.pt" }, ctx);
    expect(second.id).toBe(first.id);
    expect(passwordOf("root@a.pt")).not.toBe(pw1);
    await root(actor, ids.b, { email: "root@b.pt" }, ctx);
    const rows = await pool.query("SELECT insurer_id, role::text, created_by_platform_admin FROM insurance_accounts WHERE role='INSURANCE_ADMIN' ORDER BY email");
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]).toMatchObject({ insurer_id: ids.a, created_by_platform_admin: platformAdminId });
    await expect(
      pool.query("INSERT INTO insurance_accounts (insurer_id, email, password_hash, role) VALUES ($1,'dup@a.pt','h','INSURANCE_ADMIN')", [ids.a]),
    ).rejects.toMatchObject({ code: "23505" });
    await expect(root(actor, ids.b, { email: "root@a.pt" }, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const audit = await pool.query("SELECT metadata FROM audit_logs WHERE action='ADMIN_INSURER_ROOT_ACCOUNT' ORDER BY id");
    expect(JSON.stringify(audit.rows)).not.toContain(pw1);
  });

  it("login/refresh/logout reais; auditoria com actor_insurance_account_id; reutilização revoga a cadeia", async () => {
    const d = deps();
    const login = createInsuranceLoginUseCase(d);
    const refresh = createInsuranceRefreshUseCase(d);
    const adminA = await must(d, "root@a.pt");
    await expect(login({ email: "root@a.pt", password: "errada" }, ctx)).rejects.toMatchObject({ code: "AUTH_INVALID_CREDENTIALS" });
    const first = await login({ email: "root@a.pt", password: passwordOf("root@a.pt") }, ctx);
    expect(first).toMatchObject({ insurerId: ids.a, role: "INSURANCE_ADMIN" });
    const second = await refresh({ refreshToken: first.refreshToken }, ctx);
    const stored = await pool.query("SELECT revoked_at IS NOT NULL AS revoked, host(ip) AS ip FROM insurance_sessions WHERE insurance_account_id=$1 ORDER BY created_at, revoked_at NULLS LAST", [adminA.id]);
    expect(stored.rows).toHaveLength(2);
    expect(stored.rows.filter((r: { revoked: boolean }) => r.revoked)).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({ ip: "203.0.113.9" });
    await expect(refresh({ refreshToken: first.refreshToken }, ctx)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(refresh({ refreshToken: second.refreshToken }, ctx)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const audit = await pool.query("SELECT action, actor_type::text, actor_insurance_account_id, actor_user_id FROM audit_logs WHERE actor_insurance_account_id=$1 ORDER BY id", [adminA.id]);
    expect(audit.rows.map((r: { action: string }) => r.action)).toEqual(["INSURANCE_ACCOUNT_LOGIN_FAILED", "INSURANCE_ACCOUNT_LOGIN", "INSURANCE_ACCOUNT_REFRESH_REUSE_DETECTED", "INSURANCE_ACCOUNT_REFRESH_REUSE_DETECTED"]);
    expect(audit.rows.every((r: { actor_type: string; actor_user_id: string | null }) => r.actor_type === "INSURANCE_ACCOUNT" && r.actor_user_id === null)).toBe(true);

    const third = await login({ email: "root@a.pt", password: passwordOf("root@a.pt") }, ctx);
    const sessionId = ((await pool.query("SELECT id FROM insurance_sessions WHERE insurance_account_id=$1 AND revoked_at IS NULL", [adminA.id])).rows[0] as { id: string }).id;
    await createInsuranceLogoutUseCase(d)(adminA.id, sessionId, ctx);
    await expect(refresh({ refreshToken: third.refreshToken }, ctx)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("agentes: criados no próprio tenant, isolados entre seguradoras; remoção própria apaga a conta e as sessões (cascata)", async () => {
    const d = deps();
    const adminA = await must(d, "root@a.pt");
    const adminB = await must(d, "root@b.pt");
    const actorA = { insuranceAccountId: adminA.id, insurerId: ids.a, role: "INSURANCE_ADMIN" as const };
    const actorB = { insuranceAccountId: adminB.id, insurerId: ids.b, role: "INSURANCE_ADMIN" as const };
    const create = createCreateInsuranceAgentUseCase(d);
    const agentA = await create(actorA, { email: "agente@a.pt" }, ctx);
    const agentB = await create(actorB, { email: "agente@b.pt" }, ctx);
    await expect(create(actorA, { email: "AGENTE@b.pt" }, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect((await createListInsuranceAgentsUseCase(d)(actorA)).map((a) => a.id)).toEqual([agentA.id]);
    const remove = createRemoveInsuranceAgentUseCase(d);
    for (const target of [agentB.id, adminA.id, randomUUID()]) await expect(remove(actorA, target, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await createInsuranceLoginUseCase(d)({ email: "agente@a.pt", password: passwordOf("agente@a.pt") }, ctx);
    await remove(actorA, agentA.id, ctx);
    expect(((await pool.query("SELECT count(*)::int AS n FROM insurance_sessions WHERE insurance_account_id=$1", [agentA.id])).rows[0] as { n: number }).n).toBe(0);
    expect(((await pool.query("SELECT count(*)::int AS n FROM insurance_accounts WHERE id=$1", [agentB.id])).rows[0] as { n: number }).n).toBe(1);
    expect(((await pool.query("SELECT role::text FROM insurance_accounts WHERE id=$1", [agentB.id])).rows[0] as { role: string }).role).toBe("INSURANCE_AGENT");
  });

  it("seguradora suspensa (BR-INS-10): revoga sessões só dela, bloqueia login/refresh; reativar repõe o login", async () => {
    const d = deps();
    const login = createInsuranceLoginUseCase(d);
    const refresh = createInsuranceRefreshUseCase(d);
    const onA = await login({ email: "root@a.pt", password: passwordOf("root@a.pt") }, ctx);
    const onB = await login({ email: "root@b.pt", password: passwordOf("root@b.pt") }, ctx);
    const setStatus = createAdminSetInsurerStatusUseCase(d);
    expect(await setStatus(actor, ids.a, { status: "SUSPENDED" }, ctx)).toMatchObject({ status: "SUSPENDED" });
    const active = await pool.query("SELECT a.insurer_id, count(*)::int AS n FROM insurance_sessions s JOIN insurance_accounts a ON a.id=s.insurance_account_id WHERE s.revoked_at IS NULL GROUP BY a.insurer_id");
    expect(active.rows.map((r: { insurer_id: string }) => r.insurer_id)).toEqual([ids.b]);
    await expect(refresh({ refreshToken: onA.refreshToken }, ctx)).rejects.toBeDefined();
    await expect(login({ email: "root@a.pt", password: passwordOf("root@a.pt") }, ctx)).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED" });
    await expect(refresh({ refreshToken: onB.refreshToken }, ctx)).resolves.toMatchObject({ insurerId: ids.b });
    await setStatus(actor, ids.a, { status: "ACTIVE" }, ctx);
    await expect(login({ email: "root@a.pt", password: passwordOf("root@a.pt") }, ctx)).resolves.toMatchObject({ insurerId: ids.a });
    const statusAudit = await pool.query("SELECT metadata FROM audit_logs WHERE action='ADMIN_INSURER_STATUS' ORDER BY id");
    expect(statusAudit.rows.map((r: { metadata: { status: string } }) => r.metadata.status)).toEqual(["SUSPENDED", "ACTIVE"]);
  });

  it("eliminar a seguradora em SQL faz cascata para contas e sessões (schema.md §8)", async () => {
    const c = await new KyselyInsurersRepository().insert(db, { id: randomUUID(), name: "Efémera", taxId: "999", createdAt: clock.now() });
    const acc = await new KyselyInsuranceAccountRepository().insert(db, { id: randomUUID(), insurerId: c.id, email: "e@e.pt", passwordHash: "h", role: "INSURANCE_ADMIN", createdAt: clock.now() });
    await new KyselyInsuranceSessionRepository().insert(db, { id: randomUUID(), insuranceAccountId: acc.id, refreshTokenHash: "hh", tokenChainId: randomUUID(), expiresAt: new Date("2027-01-01"), createdAt: clock.now() });
    await pool.query("DELETE FROM insurer_accounts WHERE id=$1", [c.id]);
    expect((await pool.query("SELECT (SELECT count(*) FROM insurance_accounts WHERE insurer_id=$1)::int AS a, (SELECT count(*) FROM insurance_sessions WHERE insurance_account_id=$2)::int AS s", [c.id, acc.id])).rows[0]).toEqual({ a: 0, s: 0 });
  });
});
