// Integração real (testcontainers + PostgreSQL 16) da fatia 5 do marco B (ADR-036): migração 0041 (TC-ALR-14), alertas `authorization.*`
// sobre os adaptadores reais (`KyselyAlertsRepository`, `KyselyProcessesRepository`) — idempotência por `dedupe_key` (TC-ALR-12), mesma
// transação (reverte com a transição, TC-ALR-09) e `describeForAlerts` (aberto/fechado).
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { createRaiseAuthorizationEventUseCase } from "../../src/modules/alerts/application/raise-authorization-event.js";
import { FakeFamiliesPort, FakeNotificationsPort } from "../../src/modules/alerts/application/fixtures.js";
import { KyselyAlertsRepository } from "../../src/modules/alerts/infrastructure/repo.js";
import { createDescribeForAlertsUseCase } from "../../src/modules/processes/application/describe-for-alerts.js";
import { FakeProcessFacts } from "../../src/modules/processes/application/fixtures.js";
import { KyselyProcessesRepository } from "../../src/modules/processes/infrastructure/repo.js";

const NOW = new Date("2026-11-15T10:00:00Z");

describe("integração: migração 0041 e alertas do pedido de autorização (fatia 5)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  const clock = new FixedClock(NOW);
  const ids = { user: randomUUID(), family: randomUUID(), member: randomUUID(), pOpen: randomUUID(), pClosed: randomUUID(), authOpen: randomUUID(), apptDone: randomUUID() };
  const alertsRepo = new KyselyAlertsRepository();
  const facts = new FakeProcessFacts();
  const families = new FakeFamiliesPort();
  const notifications = new FakeNotificationsPort();
  const rows = async (sql: string, params: unknown[] = []) => (await pool.query(sql, params)).rows as Record<string, unknown>[];
  const describeProcesses = createDescribeForAlertsUseCase<Kysely<Database>>({ repo: new KyselyProcessesRepository(), facts });
  const raise = createRaiseAuthorizationEventUseCase<Kysely<Database>>({ alertsRepo, families, notifications, processes: { describe: describeProcesses }, clock });

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);
    await runMigrations(pool, defaultMigrationsDir());
    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1,'a@b.pt','x','Ana','1990-01-01','Europe/Lisbon','1',now())", [ids.user]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam')", [ids.family]);
    await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent, user_id) VALUES ($1,$2,'Ana','1990-01-01',false,$3)", [ids.member, ids.family, ids.user]);
    await pool.query("INSERT INTO processes (id, family_id, member_id, kind, origin_type, origin_id, opened_at) VALUES ($1,$2,$3,'AUTHORIZED','AUTHORIZATION',$4,now())", [ids.pOpen, ids.family, ids.member, ids.authOpen]);
    await pool.query("INSERT INTO processes (id, family_id, member_id, kind, origin_type, origin_id, opened_at) VALUES ($1,$2,$3,'ROUTINE','APPOINTMENT',$4,now())", [ids.pClosed, ids.family, ids.member, ids.apptDone]);
    facts.seedCoverage(ids.pOpen, { phase: "APPROVED", validUntil: NOW });
    facts.seed("APPOINTMENT", ids.apptDone, { phase: "DONE" });
    families.seedMember({ id: ids.member, familyId: ids.family, userId: ids.user, name: "Ana", birthDate: "1990-01-01", isDependent: false, status: "ACTIVE", createdAt: NOW });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("TC-ALR-14: os 5 tipos e a origem PROCESS aceitam inserção; o índice parcial existe; a migração é idempotente no runner", async () => {
    const enumValues = async (name: string) => (await rows(`SELECT unnest(enum_range(NULL::${name}))::text AS v`)).map((r) => r.v);
    expect(await enumValues("alert_type")).toEqual(expect.arrayContaining(["AUTHORIZATION_APPROVED", "AUTHORIZATION_NOT_APPROVED", "AUTHORIZATION_INFO_REQUESTED", "AUTHORIZATION_EXPIRING", "AUTHORIZATION_WITHDRAWN"]));
    expect(await enumValues("alert_source")).toContain("PROCESS");
    for (const type of ["AUTHORIZATION_APPROVED", "AUTHORIZATION_NOT_APPROVED", "AUTHORIZATION_INFO_REQUESTED", "AUTHORIZATION_EXPIRING", "AUTHORIZATION_WITHDRAWN"] as const) {
      await pool.query("INSERT INTO alerts (recipient_user_id, family_id, member_id, type, source_type, source_id, rule_key, dedupe_key, trigger_at) VALUES ($1,$2,$3,$4,'PROCESS',$5,'authorization.x',$6,now())", [ids.user, ids.family, ids.member, type, ids.pOpen, `raw-${type}`]);
    }
    await pool.query("DELETE FROM alerts");
    expect((await rows("SELECT indexdef FROM pg_indexes WHERE indexname='insurer_authorizations_expiring_idx'"))[0]?.indexdef).toMatch(/\(valid_until\) WHERE .*status = 'APPROVED'.* AND \(process_id IS NOT NULL\)/);
    await runMigrations(pool, defaultMigrationsDir()); // já aplicadas: nada a fazer
  });

  it("TC-ALR-09/12: o evento cria o alerta (PROCESS, dedupe_key do contrato) e repeti-lo não duplica; outro instante cria outro", async () => {
    const input = { kind: "APPROVED", processId: ids.pOpen, requestId: randomUUID(), occurredAt: NOW } as const;
    expect(await withTransaction(db, (trx) => raise(trx, input))).toBe(1);
    expect(await withTransaction(db, (trx) => raise(trx, input))).toBe(0);
    expect(await withTransaction(db, (trx) => raise(trx, { ...input, occurredAt: new Date(NOW.getTime() + 1000) }))).toBe(1);
    const stored = await rows("SELECT type, source_type, source_id, rule_key, dedupe_key, family_id, member_id, recipient_user_id FROM alerts ORDER BY trigger_at");
    expect(stored).toHaveLength(2);
    expect(stored[0]).toEqual({ type: "AUTHORIZATION_APPROVED", source_type: "PROCESS", source_id: ids.pOpen, rule_key: "authorization.approved", dedupe_key: `authorization.approved:${ids.pOpen}:${ids.user}:${NOW.toISOString()}`, family_id: ids.family, member_id: ids.member, recipient_user_id: ids.user });
    expect(notifications.enqueued).toHaveLength(2);
  });

  it("TC-ALR-09: o alerta corre na transação do chamador — se a transição falha depois, o alerta reverte-se", async () => {
    const before = Number((await rows("SELECT count(*)::int AS n FROM alerts"))[0]?.n);
    await expect(
      withTransaction(db, async (trx) => {
        await raise(trx, { kind: "WITHDRAWN", processId: ids.pOpen, requestId: randomUUID(), occurredAt: new Date(NOW.getTime() + 5000) });
        throw new Error("a transição falhou");
      }),
    ).rejects.toThrow("a transição falhou");
    expect(Number((await rows("SELECT count(*)::int AS n FROM alerts"))[0]?.n)).toBe(before);
  });

  it("processo apagado ⇒ sem alerta; o alerta existente sobrevive (source_id sem FK)", async () => {
    const gone = randomUUID();
    expect(await withTransaction(db, (trx) => raise(trx, { kind: "APPROVED", processId: gone, requestId: randomUUID(), occurredAt: NOW }))).toBe(0);
    await pool.query("DELETE FROM processes WHERE id=$1", [ids.pOpen]);
    expect(Number((await rows("SELECT count(*)::int AS n FROM alerts WHERE source_id=$1", [ids.pOpen]))[0]?.n)).toBeGreaterThan(0);
    await pool.query("INSERT INTO processes (id, family_id, member_id, kind, origin_type, origin_id, opened_at) VALUES ($1,$2,$3,'AUTHORIZED','AUTHORIZATION',$4,now())", [ids.pOpen, ids.family, ids.member, ids.authOpen]);
  });

  it("describeForAlerts com o repositório real: aprovação sem ato ⇒ aberto; consulta DONE ⇒ fechado", async () => {
    const targets = await describeProcesses(db, [ids.pOpen, ids.pClosed]);
    expect(targets.map((t) => [t.processId, t.open]).sort()).toEqual([[ids.pClosed, false], [ids.pOpen, true]].sort());
    expect(targets.every((t) => t.familyId === ids.family && t.memberId === ids.member)).toBe(true);
  });
});
