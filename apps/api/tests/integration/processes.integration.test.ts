// Integração real (testcontainers + PostgreSQL 16) da migração 0036 e dos adaptadores Kysely de `processes`
// (marco B fatia 1, ADR-032; AC-PRC-01/03/05; TC-PRC-10/11/13/14/15/17/21/23):
//  - backfill idempotente de atos anteriores à migração, igual à abertura em direto;
//  - UNIQUE (origin_type, origin_id), FK composta (isolamento), SET NULL da clínica e do `process_id`, cascata com o membro;
//  - `family_status`/`next_step` NÃO existem na BD (BR-PRC-02);
//  - rollback: sem ato não há processo (mesma transação) e a auditoria PROCESS_* reverte com ela;
//  - lista/detalhe sobre os adaptadores reais (repo de processos + factos reais de consultas/exames).
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { createGetActFactsUseCase as createAppointmentFacts } from "../../src/modules/appointments/application/act-facts.js";
import { KyselyAppointmentActFactsSource, KyselyAppointmentsRepository } from "../../src/modules/appointments/infrastructure/repo.js";
import { KyselyAuditRepository } from "../../src/modules/audit/infrastructure/repo.js";
import { createGetActFactsUseCase as createExaminationFacts } from "../../src/modules/examinations/application/act-facts.js";
import { KyselyExaminationActFactsSource, KyselyExaminationsRepository } from "../../src/modules/examinations/infrastructure/repo.js";
import { createGetProcessUseCase } from "../../src/modules/processes/application/get-process.js";
import { createDiscardProcessUseCase, createOpenProcessUseCase } from "../../src/modules/processes/application/link-process.js";
import { createListProcessesUseCase } from "../../src/modules/processes/application/list-processes.js";
import { FakeAccessPolicy } from "../../src/modules/processes/application/fixtures.js";
import type { ActFactEntry, ProcessActor, ProcessesDeps } from "../../src/modules/processes/application/ports.js";
import { KyselyProcessesRepository } from "../../src/modules/processes/infrastructure/repo.js";

const NOW = new Date("2026-06-01T12:00:00Z");
const BY: ProcessActor = { actorType: "USER", requestId: "req-int" };

describe("integração: migração 0036 e adaptadores de processes", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let scratch: string;
  const ids = {
    user: randomUUID(),
    family: randomUUID(),
    otherFamily: randomUUID(),
    member: randomUUID(),
    otherMember: randomUUID(),
    clinic: randomUUID(),
    oldAppointments: [randomUUID(), randomUUID(), randomUUID()],
    oldExam: randomUUID(),
    oldExamNoClinic: randomUUID(),
  };
  const appointments = new KyselyAppointmentsRepository();
  const examinations = new KyselyExaminationsRepository();
  const processes = new KyselyProcessesRepository();
  const audit = new KyselyAuditRepository();
  const policy = new FakeAccessPolicy();
  const clock = new FixedClock(NOW);

  const deps: ProcessesDeps<Kysely<Database>> = {
    repo: processes,
    // Factos REAIS dos módulos donos, unidos como em `main/api.ts`.
    facts: {
      getActFacts: async (trx, familyId, refs): Promise<ActFactEntry[]> => {
        const idsOf = (type: "APPOINTMENT" | "EXAMINATION") => refs.filter((r) => r.originType === type).map((r) => r.originId);
        const appointmentFacts = await createAppointmentFacts(new KyselyAppointmentActFactsSource())(trx, familyId, idsOf("APPOINTMENT"));
        const examinationFacts = await createExaminationFacts(new KyselyExaminationActFactsSource())(trx, familyId, idsOf("EXAMINATION"));
        return [
          ...appointmentFacts.map((e) => ({ originType: "APPOINTMENT" as const, originId: e.originId, fact: e.fact })),
          ...examinationFacts.map((e) => ({ originType: "EXAMINATION" as const, originId: e.originId, fact: e.fact })),
        ];
      },
    },
    policy,
    audit,
    withTransaction: (fn) => withTransaction(db, fn),
    clock,
    onInconsistency: (info) => inconsistencies.push(info),
  };
  const inconsistencies: { processId: string; originType: string }[] = [];
  const open = createOpenProcessUseCase(deps);
  const discard = createDiscardProcessUseCase(deps);

  async function newAppointment(status: "SCHEDULED" | "COMPLETED" | "REQUESTED" = "SCHEDULED", memberId = ids.member, familyId = ids.family, createdAt = new Date()): Promise<string> {
    const id = randomUUID();
    await appointments.insert(db, { id, familyId, memberId, scheduledAt: new Date("2030-01-01T10:00:00Z"), status, clinicId: ids.clinic, clinicName: "Clínica Sol", createdAt });
    return id;
  }

  /** Abre o processo e grava o ato com o `processId`, como os casos de uso dos donos. */
  async function newAppointmentWithProcess(openedAt: Date, status: "SCHEDULED" | "COMPLETED" = "SCHEDULED"): Promise<{ id: string; processId: string }> {
    const id = randomUUID();
    const processId = await withTransaction(db, async (trx) => {
      const { processId } = await createOpenProcessUseCase({ ...deps, clock: new FixedClock(openedAt) })(trx, { familyId: ids.family, memberId: ids.member, originType: "APPOINTMENT", originId: id, clinicId: ids.clinic, by: BY });
      await appointments.insert(trx, { id, processId, familyId: ids.family, memberId: ids.member, scheduledAt: new Date("2030-01-01T10:00:00Z"), status, clinicId: ids.clinic, clinicName: "Clínica Sol", createdAt: openedAt });
      return processId;
    });
    return { id, processId };
  }

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);

    // Estado ANTERIOR à 0036: só as migrações até 0035, para provar o backfill de atos já existentes.
    scratch = await mkdtemp(join(tmpdir(), "vita-migrations-"));
    for (const file of (await readdir(defaultMigrationsDir())).filter((f) => f < "0036")) {
      await cp(join(defaultMigrationsDir(), file), join(scratch, file));
    }
    await runMigrations(pool, scratch);

    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1,'a@b.pt','x','Ana','1990-01-01','Europe/Lisbon','1',now())", [ids.user]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam'), ($2,'Outra')", [ids.family, ids.otherFamily]);
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Ana','1990-01-01','FAMILY_ADMIN')", [ids.member, ids.family, ids.user]);
    await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Outro','2015-01-01',true)", [ids.otherMember, ids.otherFamily]);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica Sol')", [ids.clinic]);

    // Atos anteriores à migração (sem `process_id`: a coluna ainda nem existe).
    for (const [index, id] of ids.oldAppointments.entries()) {
      await pool.query("INSERT INTO appointments (id, family_id, member_id, scheduled_at, status, clinic_id, clinic_name, created_at) VALUES ($1,$2,$3,'2029-01-01T10:00:00Z',$4,$5,'Clínica Sol',$6)", [
        id,
        ids.family,
        ids.member,
        ["SCHEDULED", "COMPLETED", "CANCELLED"][index],
        index === 2 ? null : ids.clinic,
        new Date(`2026-0${String(index + 1)}-01T10:00:00.123456Z`),
      ]);
    }
    await pool.query("INSERT INTO examinations (id, family_id, member_id, name, exam_date, status, clinic_id, clinic_name, scheduled_at, created_at) VALUES ($1,$2,$3,'Eco','2029-02-01','SCHEDULED',$4,'Clínica Sol','2029-02-01T09:00:00Z','2026-02-15T10:00:00Z')", [ids.oldExam, ids.family, ids.member, ids.clinic]);
    await pool.query("INSERT INTO examinations (id, family_id, member_id, name, exam_date, status, created_at) VALUES ($1,$2,$3,'Análises','2020-02-01','COMPLETED','2026-02-16T10:00:00Z')", [ids.oldExamNoClinic, ids.family, ids.member]);

    await runMigrations(pool, defaultMigrationsDir()); // aplica a 0036 sobre dados existentes
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
    await rm(scratch, { recursive: true, force: true });
  });

  describe("migração 0036 e backfill (TC-PRC-14, AC-PRC-05, BR-PRC-08)", () => {
    it("regista a migração; nº de processos = nº de atos por origin_type; nenhum ato com process_id nulo; nenhum órfão", async () => {
      expect((await pool.query("SELECT version FROM schema_migrations WHERE version = '0036_processes'")).rowCount).toBe(1);
      const counts = await pool.query<{ origin_type: string; n: string }>("SELECT origin_type, count(*) AS n FROM processes GROUP BY origin_type ORDER BY origin_type");
      expect(counts.rows).toEqual([
        { origin_type: "APPOINTMENT", n: "3" },
        { origin_type: "EXAMINATION", n: "2" },
      ]);
      expect((await pool.query("SELECT 1 FROM appointments WHERE process_id IS NULL")).rowCount).toBe(0);
      expect((await pool.query("SELECT 1 FROM examinations WHERE process_id IS NULL")).rowCount).toBe(0);
      const orphans = await pool.query(
        "SELECT 1 FROM processes p WHERE NOT EXISTS (SELECT 1 FROM appointments a WHERE a.process_id = p.id AND p.origin_type = 'APPOINTMENT' AND a.id = p.origin_id) AND NOT EXISTS (SELECT 1 FROM examinations e WHERE e.process_id = p.id AND p.origin_type = 'EXAMINATION' AND e.id = p.origin_id)",
      );
      expect(orphans.rowCount).toBe(0);
    });

    it("o backfill copia membro, clínica e opened_at = created_at do ato", async () => {
      const rows = await pool.query<{ origin_id: string; member_id: string; clinic_id: string | null; opened_at: Date }>("SELECT origin_id, member_id, clinic_id, opened_at FROM processes WHERE origin_type = 'EXAMINATION' ORDER BY opened_at");
      expect(rows.rows.map((r) => [r.origin_id, r.member_id, r.clinic_id, r.opened_at.toISOString()])).toEqual([
        [ids.oldExam, ids.member, ids.clinic, "2026-02-15T10:00:00.000Z"],
        [ids.oldExamNoClinic, ids.member, null, "2026-02-16T10:00:00.000Z"],
      ]);
    });

    it("segunda execução do backfill não altera nada (idempotente)", async () => {
      const snapshot = () => pool.query("SELECT id, origin_type, origin_id, opened_at FROM processes ORDER BY id");
      const before = await snapshot();
      const sql = (await import("node:fs/promises")).readFile(join(defaultMigrationsDir(), "0036_processes.sql"), "utf8");
      const backfill = (await sql).split("-- Backfill idempotente")[1] ?? "";
      expect(backfill).toContain("ON CONFLICT");
      await pool.query(backfill.slice(backfill.indexOf("\n") + 1));
      await pool.query(backfill.slice(backfill.indexOf("\n") + 1));
      expect((await snapshot()).rows).toEqual(before.rows);
      expect((await pool.query("SELECT 1 FROM processes")).rowCount).toBe(5);
    });

    it("o estado derivado do backfill é o da abertura em direto para o mesmo estado do ato", async () => {
      const { id: liveId, processId: liveProcess } = await newAppointmentWithProcess(new Date("2026-05-10T10:00:00Z"), "COMPLETED");
      const backfilledCompleted = ids.oldAppointments[1];
      const getProcess = createGetProcessUseCase(deps);
      const backfilledProcess = (await pool.query<{ id: string }>("SELECT process_id AS id FROM appointments WHERE id = $1", [backfilledCompleted])).rows[0]?.id ?? "";
      const live = await getProcess({ userId: ids.user, platformAdmin: false }, ids.family, ids.member, liveProcess, { requestId: "r" });
      const back = await getProcess({ userId: ids.user, platformAdmin: false }, ids.family, ids.member, backfilledProcess, { requestId: "r" });
      expect([back.familyStatus, back.nextStep]).toEqual([live.familyStatus, live.nextStep]);
      expect(live.origin.id).toBe(liveId);
      await withTransaction(db, (trx) => discard(trx, { originType: "APPOINTMENT", originId: liveId, by: BY }));
      await pool.query("DELETE FROM appointments WHERE id = $1", [liveId]);
    });
  });

  describe("schema (schema.md §4b, TC-PRC-11/13/17)", () => {
    it("TC-PRC-17: a tabela não tem family_status nem next_step (estado derivado, nunca persistido)", async () => {
      const cols = await pool.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_name = 'processes'");
      const names = cols.rows.map((r) => r.column_name).sort();
      expect(names).toEqual(["clinic_id", "family_id", "id", "kind", "member_id", "opened_at", "origin_id", "origin_type"]);
      expect(names.some((n) => /status|step|phase/.test(n))).toBe(false);
    });

    it("TC-PRC-11: UNIQUE (origin_type, origin_id) e open idempotente (mesmo processId, 1 linha, 1 PROCESS_OPEN)", async () => {
      const originId = randomUUID();
      await expect(
        pool.query("INSERT INTO processes (family_id, member_id, kind, origin_type, origin_id, opened_at) VALUES ($1,$2,'ROUTINE','APPOINTMENT',$3,now()), ($1,$2,'ROUTINE','APPOINTMENT',$3,now())", [ids.family, ids.member, originId]),
      ).rejects.toMatchObject({ constraint: "processes_origin_unique" });

      const input = { familyId: ids.family, memberId: ids.member, originType: "EXAMINATION", originId, by: BY } as const;
      const first = await withTransaction(db, (trx) => open(trx, input));
      const second = await withTransaction(db, (trx) => open(trx, input));
      expect(second).toEqual(first);
      expect((await pool.query("SELECT 1 FROM processes WHERE origin_type = 'EXAMINATION' AND origin_id = $1", [originId])).rowCount).toBe(1);
      const opens = await pool.query("SELECT metadata FROM audit_logs WHERE action = 'PROCESS_OPEN' AND resource_id = $1", [first.processId]);
      expect(opens.rows).toEqual([{ metadata: { originType: "EXAMINATION", kind: "ROUTINE" } }]);
      await withTransaction(db, (trx) => discard(trx, { originType: "EXAMINATION", originId, by: BY }));
    });

    it("FK composta: membro de outra família é rejeitado (isolamento, ADR-008)", async () => {
      await expect(pool.query("INSERT INTO processes (family_id, member_id, kind, origin_type, origin_id, opened_at) VALUES ($1,$2,'ROUTINE','APPOINTMENT',$3,now())", [ids.family, ids.otherMember, randomUUID()])).rejects.toBeDefined();
    });

    it("UNIQUE parcial: dois atos não partilham o mesmo process_id; process_id pode ser NULL em vários", async () => {
      const taken = (await pool.query<{ process_id: string }>("SELECT process_id FROM appointments LIMIT 1")).rows[0]?.process_id ?? "";
      const id = await newAppointment();
      await expect(pool.query("UPDATE appointments SET process_id = $1 WHERE id = $2", [taken, id])).rejects.toMatchObject({ constraint: "appointments_process_unique_idx" });
      const other = await newAppointment();
      expect((await pool.query("SELECT 1 FROM appointments WHERE id IN ($1,$2) AND process_id IS NULL", [id, other])).rowCount).toBe(2); // 2 NULL coexistem
      await pool.query("DELETE FROM appointments WHERE id IN ($1,$2)", [id, other]);
    });

    it("TC-PRC-13: apagar a clínica põe clinic_id a NULL; apagar o processo põe process_id do ato a NULL; apagar o membro apaga por cascata", async () => {
      const clinic = randomUUID();
      await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Temp')", [clinic]);
      const processId = randomUUID();
      await pool.query("INSERT INTO processes (id, family_id, member_id, kind, origin_type, origin_id, clinic_id, opened_at) VALUES ($1,$2,$3,'ROUTINE','APPOINTMENT',$4,$5,now())", [processId, ids.family, ids.member, randomUUID(), clinic]);
      await pool.query("DELETE FROM clinics WHERE id = $1", [clinic]);
      expect((await pool.query("SELECT clinic_id FROM processes WHERE id = $1", [processId])).rows).toEqual([{ clinic_id: null }]);

      const { id: appointmentId, processId: linked } = await newAppointmentWithProcess(new Date("2026-05-11T10:00:00Z"));
      await pool.query("DELETE FROM processes WHERE id = $1", [linked]);
      expect((await pool.query("SELECT process_id FROM appointments WHERE id = $1", [appointmentId])).rows).toEqual([{ process_id: null }]);

      const doomedMember = randomUUID();
      await pool.query("INSERT INTO family_members (id, family_id, name, birth_date) VALUES ($1,$2,'Temp','1990-01-01')", [doomedMember, ids.family]);
      const doomedAppointment = await newAppointment("SCHEDULED", doomedMember);
      await pool.query("INSERT INTO processes (family_id, member_id, kind, origin_type, origin_id, opened_at) VALUES ($1,$2,'ROUTINE','APPOINTMENT',$3,now())", [ids.family, doomedMember, doomedAppointment]);
      await pool.query("DELETE FROM family_members WHERE id = $1", [doomedMember]);
      expect((await pool.query("SELECT 1 FROM processes WHERE member_id = $1", [doomedMember])).rowCount).toBe(0);
      await pool.query("DELETE FROM appointments WHERE id = $1", [appointmentId]);
      await pool.query("DELETE FROM processes WHERE id = $1", [processId]);
    });
  });

  describe("transação do ato (TC-PRC-10/21, BR-PRC-01/11)", () => {
    it("rollback: se o ato falha depois de `open`, não ficam nem processo nem auditoria PROCESS_OPEN", async () => {
      const id = randomUUID();
      await expect(
        withTransaction(db, async (trx) => {
          await open(trx, { familyId: ids.family, memberId: ids.member, originType: "APPOINTMENT", originId: id, by: { ...BY, requestId: "req-rollback" } });
          throw new Error("falha a gravar o ato");
        }),
      ).rejects.toThrow("falha a gravar o ato");
      expect((await pool.query("SELECT 1 FROM processes WHERE origin_id = $1", [id])).rowCount).toBe(0);
      expect((await pool.query("SELECT 1 FROM audit_logs WHERE request_id = 'req-rollback'")).rowCount).toBe(0);
    });

    it("discard apaga o processo e audita PROCESS_DISCARD só com originType", async () => {
      const { id, processId } = await newAppointmentWithProcess(new Date("2026-05-12T10:00:00Z"));
      await withTransaction(db, async (trx) => {
        await appointments.delete(trx, ids.family, ids.member, id);
        await discard(trx, { originType: "APPOINTMENT", originId: id, by: BY });
      });
      expect((await pool.query("SELECT 1 FROM processes WHERE id = $1", [processId])).rowCount).toBe(0);
      const events = await pool.query("SELECT metadata, family_id, subject_member_id FROM audit_logs WHERE action = 'PROCESS_DISCARD' AND resource_id = $1", [processId]);
      expect(events.rows).toEqual([{ metadata: { originType: "APPOINTMENT" }, family_id: ids.family, subject_member_id: ids.member }]);
    });
  });

  describe("leitura sobre os adaptadores reais (TC-PRC-15/23, BR-PRC-09)", () => {
    const actor = { userId: ids.user, platformAdmin: false };
    const ctx = { requestId: "req-read" };

    it("lista: openedAt desc/id desc sem duplicados, filtro status depois da derivação, cursor estável com microssegundos do backfill", async () => {
      const list = createListProcessesUseCase(deps);
      const all: string[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const page = await list(actor, ids.family, ids.member, { limit: "2", ...(cursor ? { cursor } : {}) }, ctx);
        all.push(...page.items.map((i) => i.id));
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }
      expect(all).toHaveLength(5);
      expect(new Set(all).size).toBe(5);

      const done = await list(actor, ids.family, ids.member, { status: "DONE", limit: "1" }, ctx);
      expect(done.items.map((i) => i.familyStatus)).toEqual(["DONE"]);
      let found = done.items.length;
      let next = done.nextCursor;
      while (next) {
        const page = await list(actor, ids.family, ids.member, { status: "DONE", limit: "1", cursor: next }, ctx);
        found += page.items.length;
        next = page.nextCursor;
      }
      expect(found).toBe(2); // 1 consulta COMPLETED + 1 exame COMPLETED
      expect((await list(actor, ids.family, ids.member, { originType: "EXAMINATION" }, ctx)).items.every((i) => i.origin.type === "EXAMINATION")).toBe(true);
      // Outro membro/família nunca vê estes processos.
      expect((await list(actor, ids.otherFamily, ids.otherMember, {}, ctx)).items).toEqual([]);
    });

    it("exame aberto em direto (open + insert na mesma transação): detalhe com a fase do exame e scheduledAt", async () => {
      const id = randomUUID();
      const scheduledAt = new Date("2030-03-01T09:00:00Z");
      const processId = await withTransaction(db, async (trx) => {
        const { processId } = await open(trx, { familyId: ids.family, memberId: ids.member, originType: "EXAMINATION", originId: id, clinicId: ids.clinic, by: BY });
        await examinations.insert(trx, { id, processId, familyId: ids.family, memberId: ids.member, name: "Ecografia", examDate: "2030-03-01", status: "SCHEDULED", clinicId: ids.clinic, clinicName: "Clínica Sol", scheduledAt, createdAt: NOW });
        return processId;
      });
      const view = await createGetProcessUseCase(deps)(actor, ids.family, ids.member, processId, ctx);
      expect(view).toMatchObject({ familyStatus: "SCHEDULED", nextStep: { code: "ATTEND", actor: "FAMILY" }, origin: { type: "EXAMINATION", id }, scheduledAt: scheduledAt.toISOString() });
      expect((await pool.query("SELECT process_id FROM examinations WHERE id = $1", [id])).rows).toEqual([{ process_id: processId }]);
      await withTransaction(db, async (trx) => {
        await examinations.delete(trx, ids.family, ids.member, id);
        await discard(trx, { originType: "EXAMINATION", originId: id, by: BY });
      });
    });

    it("TC-PRC-23: processo cujo ato foi removido por inconsistência forçada: lista omite, detalhe 404, nunca 5xx", async () => {
      const { id, processId } = await newAppointmentWithProcess(new Date("2026-05-13T10:00:00Z"));
      await pool.query("DELETE FROM appointments WHERE id = $1", [id]); // o processo fica (sem FK da origem)
      const before = inconsistencies.length;
      const list = await createListProcessesUseCase(deps)(actor, ids.family, ids.member, { limit: "100" }, ctx);
      expect(list.items.map((i) => i.id)).not.toContain(processId);
      await expect(createGetProcessUseCase(deps)(actor, ids.family, ids.member, processId, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(inconsistencies.length).toBeGreaterThan(before);
      expect(inconsistencies.at(-1)).toEqual({ processId, originType: "APPOINTMENT" });
      await pool.query("DELETE FROM processes WHERE id = $1", [processId]);
    });
  });
});
