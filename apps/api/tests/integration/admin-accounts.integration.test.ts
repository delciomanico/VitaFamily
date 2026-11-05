// Integração real (testcontainers + PostgreSQL 16) da Fase 3 (ADR-023, BR-ADM-01..04/07, AC-ADM-*):
// pesquisa `q` com metacaracteres LIKE, estatísticas de sessões, reposição de acesso (revogação real
// + token só na BD/e-mail), contas de clínica (isolamento por clínica, lastLoginAt, revogação de
// clinic_sessions, CONFLICT pelo índice único parcial) e auditoria sem PII.
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { KyselyAuditRepository } from "../../src/modules/audit/infrastructure/repo.js";
import {
  createAdminGetUserUseCase,
  createAdminListUsersUseCase,
  createAdminResetUserAccessUseCase,
  type AdminAccountsDeps,
} from "../../src/modules/admin/application/accounts.js";
import { createGetSessionStatsUseCase, createResetUserAccessUseCase } from "../../src/modules/auth/application/admin-access.js";
import { FakeLogger, FakeMailer } from "../../src/modules/auth/application/fixtures.js";
import type { AuthDeps } from "../../src/modules/auth/application/ports.js";
import { InMemoryRateLimiter } from "../../src/modules/auth/domain/rate-limiter.js";
import { KyselyAuthTokenRepository, KyselySessionRepository } from "../../src/modules/auth/infrastructure/repo.js";
import {
  createAdminListClinicAccountsUseCase,
  createAdminReactivateClinicAccountUseCase,
  createAdminSuspendClinicAccountUseCase,
} from "../../src/modules/clinics/application/admin-clinic-accounts.js";
import type { ClinicsDeps } from "../../src/modules/clinics/application/ports.js";
import { KyselyClinicAccountRepository, KyselyClinicSessionRepository } from "../../src/modules/clinics/infrastructure/clinic-account-repo.js";
import { KyselyClinicsRepository } from "../../src/modules/clinics/infrastructure/repo.js";
import { KyselyUsersRepository } from "../../src/modules/users/infrastructure/repo.js";
import { createRawOperations } from "../../src/modules/users/application/raw-operations.js";
import { KyselyMembersRepository } from "../../src/modules/families/infrastructure/repo.js";

describe("integração: admin de contas (Fase 3)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  const clock = new FixedClock(new Date("2026-11-05T10:00:00Z"));
  const ids = { admin: randomUUID(), ana: randomUUID(), pending: randomUUID(), clinicA: randomUUID(), clinicB: randomUUID(), adminA: randomUUID(), mgrA: randomUUID(), adminB: randomUUID() };
  const ctx = { requestId: "r1" };
  const actor = { userId: ids.admin, platformAdmin: true };
  const mailer = new FakeMailer();

  const usersRepo = new KyselyUsersRepository();
  const raw = createRawOperations(usersRepo);
  const audit = new KyselyAuditRepository();

  function adminDeps(): AdminAccountsDeps<Kysely<Database>> {
    const authDeps = {
      usersPort: { byId: raw.byId },
      authTokenRepo: new KyselyAuthTokenRepository(),
      sessionRepo: new KyselySessionRepository(),
      clock,
      mailer,
      logger: new FakeLogger() as unknown as AuthDeps<Kysely<Database>>["logger"],
      rateLimiter: new InMemoryRateLimiter(clock),
    } as unknown as AuthDeps<Kysely<Database>>;
    const members = new KyselyMembersRepository();
    return {
      clock,
      withTransaction: (fn) => withTransaction(db, fn),
      audit,
      users: raw,
      auth: { resetUserAccess: createResetUserAccessUseCase(authDeps), getSessionStats: createGetSessionStatsUseCase(authDeps) },
      families: { countFamiliesOfUser: async (trx, userId) => (await members.listFamilyIdsForUser(trx, userId)).length },
    };
  }

  function clinicsDeps(): ClinicsDeps<Kysely<Database>> {
    const partial: Pick<ClinicsDeps<Kysely<Database>>, "clinicsRepo" | "clinicAccountRepo" | "clinicSessionRepo" | "audit" | "withTransaction" | "clock"> = {
      clinicsRepo: new KyselyClinicsRepository(),
      clinicAccountRepo: new KyselyClinicAccountRepository(),
      clinicSessionRepo: new KyselyClinicSessionRepository(),
      audit,
      withTransaction: (fn) => withTransaction(db, fn),
      clock,
    };
    return partial as ClinicsDeps<Kysely<Database>>;
  }

  const insertSession = (table: "sessions" | "clinic_sessions", ownerCol: string, owner: string, chain: string, createdAt: string, revoked = false) =>
    pool.query(
      `INSERT INTO ${table} (${ownerCol}, refresh_token_hash, token_chain_id, expires_at, created_at, last_used_at, revoked_at) VALUES ($1,$2,$3,'2027-01-01',$4,$4,$5)`,
      [owner, randomUUID(), chain, createdAt, revoked ? createdAt : null],
    );

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);
    await runMigrations(pool, defaultMigrationsDir());

    const user = (id: string, email: string, name: string, status: string, role = "NONE") =>
      pool.query(
        "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, platform_role, email_verified_at, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'hash-secreto',$3,'1990-01-01','Europe/Lisbon',$4::text::user_status,$5::text::platform_role,CASE WHEN $4::text='PENDING_VERIFICATION' THEN NULL ELSE now() END,'1',now())",
        [id, email, name, status, role],
      );
    await user(ids.admin, "admin@vita.pt", "Administrador", "ACTIVE", "PLATFORM_ADMIN");
    await user(ids.ana, "ana.silva@x.pt", "Ana Silva", "ACTIVE");
    await user(ids.pending, "100%_novo@x.pt", "Novo Pendente", "PENDING_VERIFICATION");
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Família Segredo')", [ids.clinicA]);
    await pool.query("INSERT INTO family_members (family_id, user_id, name, birth_date, role) VALUES ($1,$2,'Ana Silva','1990-01-01','FAMILY_ADMIN')", [ids.clinicA, ids.ana]);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','A'), ($2,'PARTNER','B')", [ids.clinicA, ids.clinicB]);
    const acc = (id: string, clinic: string, email: string, role: string) =>
      pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,$3,'hash-secreto',$4)", [id, clinic, email, role]);
    await acc(ids.adminA, ids.clinicA, "admin@a.pt", "CLINIC_ADMIN");
    await acc(ids.mgrA, ids.clinicA, "gestor@a.pt", "CLINIC_MANAGER");
    await acc(ids.adminB, ids.clinicB, "admin@b.pt", "CLINIC_ADMIN");
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("pesquisa q: parcial por e-mail ou nome, sem distinguir maiúsculas; % e _ são literais", async () => {
    const list = createAdminListUsersUseCase(adminDeps());
    expect((await list(actor, { q: "SILVA" })).items.map((u) => u.id)).toEqual([ids.ana]);
    expect((await list(actor, { q: "pendente" })).items.map((u) => u.id)).toEqual([ids.pending]);
    expect((await list(actor, { q: "100%_" })).items.map((u) => u.id)).toEqual([ids.pending]);
    expect((await list(actor, { q: "%%" })).items).toEqual([]);
    expect((await list(actor, { q: "zzz" })).items).toEqual([]);
    expect((await list(actor, { q: "a%", status: "ACTIVE" })).items).toEqual([]);
  });

  it("detalhe: contagens reais (famílias, sessões ativas/último uso) e nenhum dado de saúde/famílias", async () => {
    await insertSession("sessions", "user_id", ids.ana, randomUUID(), "2026-11-01T10:00:00Z");
    await insertSession("sessions", "user_id", ids.ana, randomUUID(), "2026-11-03T10:00:00Z");
    await insertSession("sessions", "user_id", ids.ana, randomUUID(), "2026-11-04T10:00:00Z", true);
    await pool.query("INSERT INTO sessions (user_id, refresh_token_hash, token_chain_id, expires_at, last_used_at) VALUES ($1,$2,$3,'2026-01-01','2026-01-01')", [ids.ana, randomUUID(), randomUUID()]); // expirada
    const detail = await createAdminGetUserUseCase(adminDeps())(actor, ids.ana);
    expect(detail).toMatchObject({ id: ids.ana, name: "Ana Silva", familiesCount: 1, activeSessionsCount: 2, platformRole: "NONE", suspendedAt: null });
    expect(detail.lastSessionUsedAt).toEqual(new Date("2026-11-04T10:00:00Z"));
    expect(JSON.stringify(detail)).not.toMatch(/Segredo|hash-secreto|1990/);
    await expect(createAdminGetUserUseCase(adminDeps())(actor, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reset-access: revoga todas as sessões (só do alvo), cria 1 token e 1 e-mail, audita sem token/e-mail", async () => {
    await insertSession("sessions", "user_id", ids.pending, randomUUID(), "2026-11-03T10:00:00Z"); // de outro utilizador
    const reset = createAdminResetUserAccessUseCase(adminDeps());
    await reset(actor, ids.ana, ctx);

    expect((await pool.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [ids.ana])).rows[0]).toEqual({ n: 0 });
    expect((await pool.query("SELECT count(*)::int AS n FROM sessions WHERE user_id=$1 AND revoked_at IS NULL", [ids.pending])).rows[0]).toEqual({ n: 1 });
    const tokens = await pool.query("SELECT type, used_at FROM auth_tokens WHERE user_id=$1", [ids.ana]);
    expect(tokens.rows).toEqual([{ type: "PASSWORD_RESET", used_at: null }]);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("ana.silva@x.pt");

    await reset(actor, ids.pending, ctx);
    expect((await pool.query("SELECT type FROM auth_tokens WHERE user_id=$1", [ids.pending])).rows).toEqual([{ type: "EMAIL_VERIFICATION" }]);

    const logs = await pool.query("SELECT actor_type, actor_user_id, action, resource_id, metadata::text AS metadata FROM audit_logs WHERE action='ADMIN_USER_RESET_ACCESS' ORDER BY id");
    expect(logs.rows.map((r: { action: string; resource_id: string; actor_type: string }) => [r.action, r.resource_id, r.actor_type])).toEqual([
      ["ADMIN_USER_RESET_ACCESS", ids.ana, "PLATFORM_ADMIN"],
      ["ADMIN_USER_RESET_ACCESS", ids.pending, "PLATFORM_ADMIN"],
    ]);
    const serialised = JSON.stringify(logs.rows);
    expect(serialised).not.toMatch(/ana\.silva|@x\.pt/);
    const token = (mailer.sent[0]?.text.match(/código: (\S+)/) ?? [])[1] ?? "never";
    expect(serialised).not.toContain(token);
    // O token em claro nunca fica na BD (só o hash).
    expect((await pool.query("SELECT 1 FROM auth_tokens WHERE token_hash=$1", [token])).rowCount).toBe(0);
  });

  it("reset-access sobre si próprio -> FORBIDDEN, sem alterações", async () => {
    await expect(createAdminResetUserAccessUseCase(adminDeps())(actor, ids.admin, ctx)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await pool.query("SELECT count(*)::int AS n FROM auth_tokens WHERE user_id=$1", [ids.admin])).rows[0]).toEqual({ n: 0 });
  });

  it("lista de contas da clínica: lastLoginAt = início da cadeia mais recente (refresh não conta), isolada por clínica", async () => {
    const chain1 = randomUUID();
    await insertSession("clinic_sessions", "clinic_account_id", ids.adminA, chain1, "2026-11-01T08:00:00Z", true);
    await insertSession("clinic_sessions", "clinic_account_id", ids.adminA, chain1, "2026-11-04T08:00:00Z"); // rotação da mesma cadeia
    await insertSession("clinic_sessions", "clinic_account_id", ids.adminA, randomUUID(), "2026-11-02T08:00:00Z"); // login mais recente = cadeia 2
    await insertSession("clinic_sessions", "clinic_account_id", ids.adminB, randomUUID(), "2026-11-03T08:00:00Z");

    const list = await createAdminListClinicAccountsUseCase(clinicsDeps())(actor, ids.clinicA);
    expect(list.map((a) => a.id).sort()).toEqual([ids.adminA, ids.mgrA].sort());
    expect(list.find((a) => a.id === ids.adminA)?.lastLoginAt).toEqual(new Date("2026-11-02T08:00:00Z"));
    expect(list.find((a) => a.id === ids.mgrA)?.lastLoginAt).toBeNull();
    expect(JSON.stringify(list)).not.toContain("hash-secreto");
    await expect(createAdminListClinicAccountsUseCase(clinicsDeps())(actor, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("suspender: revoga de imediato as clinic_sessions só dessa conta, regista suspended_at e audita sem motivo", async () => {
    await insertSession("clinic_sessions", "clinic_account_id", ids.mgrA, randomUUID(), "2026-11-04T08:00:00Z");
    await insertSession("clinic_sessions", "clinic_account_id", ids.mgrA, randomUUID(), "2026-11-04T09:00:00Z");
    const suspend = createAdminSuspendClinicAccountUseCase(clinicsDeps());
    await suspend(actor, ids.clinicA, ids.mgrA, { reason: "Contacto: gestor@a.pt" }, ctx);

    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_sessions WHERE clinic_account_id=$1 AND revoked_at IS NULL", [ids.mgrA])).rows[0]).toEqual({ n: 0 });
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_sessions WHERE clinic_account_id=$1 AND revoked_at IS NULL", [ids.adminA])).rows[0]).toEqual({ n: 2 });
    expect((await pool.query("SELECT status, suspended_at IS NOT NULL AS s FROM clinic_accounts WHERE id=$1", [ids.mgrA])).rows[0]).toEqual({ status: "SUSPENDED", s: true });
    const logs = await pool.query("SELECT action, metadata::text AS metadata FROM audit_logs WHERE action='ADMIN_CLINIC_ACCOUNT_SUSPEND'");
    expect(logs.rows).toHaveLength(1);
    expect(JSON.stringify(logs.rows)).not.toContain("gestor@a.pt");
  });

  it("404 sem enumeração: conta de outra clínica e conta inexistente respondem igual; nada muda", async () => {
    const suspend = createAdminSuspendClinicAccountUseCase(clinicsDeps());
    const other = await suspend(actor, ids.clinicA, ids.adminB, { reason: "x" }, ctx).catch((e: unknown) => e);
    const missing = await suspend(actor, ids.clinicA, randomUUID(), { reason: "x" }, ctx).catch((e: unknown) => e);
    expect(other).toMatchObject({ code: "NOT_FOUND" });
    expect((other as Error).message).toBe((missing as Error).message);
    expect((await pool.query("SELECT status FROM clinic_accounts WHERE id=$1", [ids.adminB])).rows[0]).toEqual({ status: "ACTIVE" });
  });

  it("reativar CLINIC_ADMIN com outro ativo -> CONFLICT (índice único parcial); sem outro ativo -> ACTIVE", async () => {
    const suspend = createAdminSuspendClinicAccountUseCase(clinicsDeps());
    const reactivate = createAdminReactivateClinicAccountUseCase(clinicsDeps());
    await suspend(actor, ids.clinicA, ids.adminA, { reason: "x" }, ctx);
    const replacement = randomUUID();
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'novo@a.pt','x','CLINIC_ADMIN')", [replacement, ids.clinicA]);

    await expect(reactivate(actor, ids.clinicA, ids.adminA, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await pool.query("SELECT status FROM clinic_accounts WHERE id=$1", [ids.adminA])).rows[0]).toEqual({ status: "SUSPENDED" });

    await pool.query("UPDATE clinic_accounts SET status='SUSPENDED' WHERE id=$1", [replacement]);
    await reactivate(actor, ids.clinicA, ids.adminA, ctx);
    expect((await pool.query("SELECT status, suspended_at FROM clinic_accounts WHERE id=$1", [ids.adminA])).rows[0]).toEqual({ status: "ACTIVE", suspended_at: null });
    await reactivate(actor, ids.clinicA, ids.mgrA, ctx);
    expect((await pool.query("SELECT action FROM audit_logs WHERE action='ADMIN_CLINIC_ACCOUNT_REACTIVATE'")).rowCount).toBe(2);
  });
});
