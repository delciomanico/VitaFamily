// Integração real (testcontainers + PostgreSQL 16) da migração 0023 e do repositório Kysely de
// `recommendations` (ADR-023, D19, BR-CLN-09; AC-REC-01):
//  - CHECK de origem única e de tamanho do texto; enums de alerta novos;
//  - isolamento entre clínicas (listByClinic) e entre famílias/categorias (listByMember);
//  - remoção da conta autora/da clínica: ON DELETE SET NULL válido (NENHUMA CHECK exige a conta
//    não-nula) e a recomendação continua legível pela família com `clinic_name` congelado;
//  - cascata com a consulta/exame/membro (D15); caso de uso real sobre as repos reais.
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { KyselyAppointmentsRepository } from "../../src/modules/appointments/infrastructure/repo.js";
import { KyselyExaminationsRepository } from "../../src/modules/examinations/infrastructure/repo.js";
import { createCreateClinicRecommendationUseCase, createListClinicRecommendationsUseCase } from "../../src/modules/recommendations/application/clinic-recommendations.js";
import { FakeAccessPolicy, FakeAuditPort, FakeMemberNamesPort, FakeRecommendationAlertsPort } from "../../src/modules/recommendations/application/fixtures.js";
import { createListRecommendationsUseCase } from "../../src/modules/recommendations/application/list-recommendations.js";
import type { RecommendationsDeps } from "../../src/modules/recommendations/application/ports.js";
import { KyselyRecommendationsRepository } from "../../src/modules/recommendations/infrastructure/repo.js";

describe("integração: migração 0023 e repositório de recomendações", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  const ids = {
    user: randomUUID(),
    family: randomUUID(),
    otherFamily: randomUUID(),
    member: randomUUID(),
    otherMember: randomUUID(),
    clinic: randomUUID(),
    otherClinic: randomUUID(),
    account: randomUUID(),
    otherAccount: randomUUID(),
  };
  const appointments = new KyselyAppointmentsRepository();
  const examinations = new KyselyExaminationsRepository();
  const repo = new KyselyRecommendationsRepository();
  const FUTURE = new Date("2030-01-01T10:00:00Z");

  async function newAppointment(status: "SCHEDULED" | "COMPLETED" | "CANCELLED" = "SCHEDULED", clinicId = ids.clinic, memberId = ids.member, familyId = ids.family): Promise<string> {
    const id = randomUUID();
    await appointments.insert(db, { id, familyId, memberId, scheduledAt: FUTURE, status, clinicId, clinicName: "Clínica Sol", createdAt: new Date() });
    return id;
  }

  async function newExam(status: "SCHEDULED" | "COMPLETED" | "CANCELLED" = "SCHEDULED", clinicId = ids.clinic): Promise<string> {
    const id = randomUUID();
    await examinations.insert(db, { id, familyId: ids.family, memberId: ids.member, name: "Ecografia", examDate: "2030-01-01", status, clinicId, clinicName: "Clínica Sol", scheduledAt: FUTURE, createdAt: new Date() });
    return id;
  }

  async function addRec(origin: { appointmentId: string } | { examinationId: string }, text = "nota", account = ids.account, clinic = ids.clinic, createdAt = new Date()): Promise<string> {
    const id = randomUUID();
    await repo.insert(db, { id, familyId: ids.family, memberId: ids.member, clinicId: clinic, clinicName: "Clínica Sol", clinicAccountId: account, text, createdAt, ...origin });
    return id;
  }

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
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam'), ($2,'Outra')", [ids.family, ids.otherFamily]);
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Ana','1990-01-01','FAMILY_ADMIN')", [ids.member, ids.family, ids.user]);
    await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Outro','2015-01-01',true)", [ids.otherMember, ids.otherFamily]);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica Sol'), ($2,'PARTNER','Outra')", [ids.clinic, ids.otherClinic]);
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'c@c.pt','x','CLINIC_ADMIN'), ($3,$4,'d@d.pt','x','CLINIC_ADMIN')", [ids.account, ids.clinic, ids.otherAccount, ids.otherClinic]);
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("aplica 0023 e regista-a; os enums de alerta aceitam RECOMMENDATION_ADDED / RECOMMENDATION", async () => {
    const applied = await pool.query("SELECT version FROM schema_migrations WHERE version = '0023_recommendations' ORDER BY version");
    expect(applied.rows.map((r: { version: string }) => r.version)).toEqual(["0023_recommendations"]);
    const appointmentId = await newAppointment();
    const recId = await addRec({ appointmentId });
    await pool.query(
      "INSERT INTO alerts (recipient_user_id, family_id, member_id, type, source_type, source_id, rule_key, dedupe_key, trigger_at) VALUES ($1,$2,$3,'RECOMMENDATION_ADDED','RECOMMENDATION',$4,'recommendation.added','k1',now())",
      [ids.user, ids.family, ids.member, recId],
    );
    const alert = await pool.query("SELECT type, source_type FROM alerts WHERE dedupe_key = 'k1'");
    expect(alert.rows[0]).toEqual({ type: "RECOMMENDATION_ADDED", source_type: "RECOMMENDATION" });
  });

  describe("CHECKs (schema.md §3)", () => {
    const insert = (appointmentId: string | null, examinationId: string | null, text: string) =>
      pool.query("INSERT INTO recommendations (family_id, member_id, clinic_name, appointment_id, examination_id, text) VALUES ($1,$2,'x',$3,$4,$5)", [ids.family, ids.member, appointmentId, examinationId, text]);

    it("exatamente uma origem: nenhuma ou duas violam a CHECK", async () => {
      const a = await newAppointment();
      const e = await newExam();
      await expect(insert(null, null, "x")).rejects.toMatchObject({ constraint: "recommendations_single_origin_check" });
      await expect(insert(a, e, "x")).rejects.toMatchObject({ constraint: "recommendations_single_origin_check" });
      await expect(insert(a, null, "x")).resolves.toBeDefined();
    });

    it("texto 1-2000 caracteres", async () => {
      const a = await newAppointment();
      await expect(insert(a, null, "")).rejects.toMatchObject({ constraint: "recommendations_text_length_check" });
      await expect(insert(a, null, "a".repeat(2001))).rejects.toMatchObject({ constraint: "recommendations_text_length_check" });
      await expect(insert(a, null, "a".repeat(2000))).resolves.toBeDefined();
    });

    it("FK composta: membro de outra família é rejeitado (isolamento, ADR-008)", async () => {
      const a = await newAppointment();
      await expect(pool.query("INSERT INTO recommendations (family_id, member_id, clinic_name, appointment_id, text) VALUES ($1,$2,'x',$3,'x')", [ids.family, ids.otherMember, a])).rejects.toBeDefined();
    });
  });

  describe("isolamento e leitura", () => {
    it("listByClinic: só as da própria clínica, com filtro por origem; listByMember filtra por categoria e pagina", async () => {
      const fam = randomUUID();
      const mem = randomUUID();
      const clinicX = randomUUID();
      const clinicY = randomUUID();
      const accountX = randomUUID();
      const accountY = randomUUID();
      await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','X'), ($2,'PARTNER','Y')", [clinicX, clinicY]);
      await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'x@c.pt','x','CLINIC_ADMIN'), ($3,$4,'y@c.pt','x','CLINIC_ADMIN')", [accountX, clinicX, accountY, clinicY]);
      await pool.query("INSERT INTO families (id, name) VALUES ($1,'F2')", [fam]);
      await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Dep','2015-01-01',true)", [mem, fam]);
      const a = await newAppointment("SCHEDULED", clinicX, mem, fam);
      const e = randomUUID();
      await examinations.insert(db, { id: e, familyId: fam, memberId: mem, name: "Eco", examDate: "2030-01-01", status: "COMPLETED", clinicId: clinicX, clinicName: "Clínica Sol", scheduledAt: FUTURE, createdAt: new Date() });
      const aOther = await newAppointment("SCHEDULED", clinicY, mem, fam);
      const t0 = new Date("2030-01-01T00:00:00Z");
      const recA = randomUUID();
      const recE = randomUUID();
      await repo.insert(db, { id: recA, familyId: fam, memberId: mem, clinicId: clinicX, clinicName: "Clínica Sol", clinicAccountId: accountX, appointmentId: a, text: "consulta", createdAt: t0 });
      await repo.insert(db, { id: recE, familyId: fam, memberId: mem, clinicId: clinicX, clinicName: "Clínica Sol", clinicAccountId: accountX, examinationId: e, text: "exame", createdAt: new Date(t0.getTime() + 1000) });
      await repo.insert(db, { id: randomUUID(), familyId: fam, memberId: mem, clinicId: clinicY, clinicName: "Outra", clinicAccountId: accountY, appointmentId: aOther, text: "outra", createdAt: t0 });

      expect((await repo.listByClinic(db, clinicX, {}, 50)).map((r) => r.text)).toEqual(["exame", "consulta"]);
      expect((await repo.listByClinic(db, clinicX, { appointmentId: a }, 50)).map((r) => r.text)).toEqual(["consulta"]);
      expect((await repo.listByClinic(db, clinicY, {}, 50)).map((r) => r.text)).toEqual(["outra"]);
      expect(await repo.listByClinic(db, clinicY, { examinationId: e }, 50)).toEqual([]);

      const both = await repo.listByMember(db, fam, mem, { categories: ["APPOINTMENTS", "EXAMS"] }, 50);
      expect(both.items.map((r) => r.text).sort()).toEqual(["consulta", "exame", "outra"]);
      expect(both.items[0]?.text).toBe("exame");
      expect((await repo.listByMember(db, fam, mem, { categories: ["EXAMS"] }, 50)).items.map((r) => r.text)).toEqual(["exame"]);
      expect((await repo.listByMember(db, fam, mem, { categories: ["APPOINTMENTS"] }, 50)).items.map((r) => r.text).sort()).toEqual(["consulta", "outra"]);
      expect((await repo.listByMember(db, fam, mem, { categories: [] }, 50)).items).toEqual([]);
      // Outra família nunca vê estas (conventions.md §3.4).
      expect((await repo.listByMember(db, ids.family, mem, { categories: ["APPOINTMENTS", "EXAMS"] }, 50)).items).toEqual([]);

      const p1 = await repo.listByMember(db, fam, mem, { categories: ["APPOINTMENTS", "EXAMS"] }, 2);
      expect(p1.items).toHaveLength(2);
      expect(p1.nextCursor).not.toBeNull();
      const p2 = await repo.listByMember(db, fam, mem, { categories: ["APPOINTMENTS", "EXAMS"] }, 2, p1.nextCursor ?? undefined);
      expect(p2.items).toHaveLength(1);
      expect(p2.nextCursor).toBeNull();
      expect(new Set([...p1.items, ...p2.items].map((r) => r.id)).size).toBe(3);
    });
  });

  describe("remoção da conta autora / da clínica (ON DELETE SET NULL, BR-CLN-05)", () => {
    it("apagar a conta autora: a linha continua válida (sem CHECK que exija a conta), legível e listada pela clínica", async () => {
      const account = randomUUID();
      await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'m@c.pt','x','CLINIC_MANAGER')", [account, ids.clinic]);
      const appointmentId = await newAppointment();
      const recId = await addRec({ appointmentId }, "persiste", account);

      await expect(pool.query("DELETE FROM clinic_accounts WHERE id = $1", [account])).resolves.toBeDefined();

      const row = await pool.query("SELECT clinic_account_id, clinic_id, clinic_name, text FROM recommendations WHERE id = $1", [recId]);
      expect(row.rows[0]).toEqual({ clinic_account_id: null, clinic_id: ids.clinic, clinic_name: "Clínica Sol", text: "persiste" });
      const read = await repo.listByMember(db, ids.family, ids.member, { categories: ["APPOINTMENTS"], appointmentId }, 10);
      expect(read.items).toHaveLength(1);
      expect(read.items[0]?.clinicAccountId).toBeUndefined();
      expect((await repo.listByClinic(db, ids.clinic, { appointmentId }, 10)).map((r) => r.id)).toEqual([recId]);
    });

    it("apagar a clínica: clinic_id fica nulo, clinic_name congelado mantém-se e a família continua a ler", async () => {
      const clinic = randomUUID();
      await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Efémera')", [clinic]);
      const appointmentId = await newAppointment("SCHEDULED", clinic);
      const recId = await addRec({ appointmentId }, "sem clínica", ids.account, clinic);
      await expect(pool.query("DELETE FROM clinics WHERE id = $1", [clinic])).resolves.toBeDefined();
      const row = await pool.query("SELECT clinic_id, clinic_name FROM recommendations WHERE id = $1", [recId]);
      expect(row.rows[0]).toEqual({ clinic_id: null, clinic_name: "Clínica Sol" });
    });
  });

  describe("cascata (D15)", () => {
    it("apagar a consulta / o exame / o membro apaga as recomendações", async () => {
      const appointmentId = await newAppointment();
      const examinationId = await newExam();
      await addRec({ appointmentId });
      await addRec({ examinationId });
      await pool.query("DELETE FROM appointments WHERE id = $1", [appointmentId]);
      expect((await pool.query("SELECT 1 FROM recommendations WHERE appointment_id = $1", [appointmentId])).rowCount).toBe(0);
      await pool.query("DELETE FROM examinations WHERE id = $1", [examinationId]);
      expect((await pool.query("SELECT 1 FROM recommendations WHERE examination_id = $1", [examinationId])).rowCount).toBe(0);

      const fam = randomUUID();
      const mem = randomUUID();
      await pool.query("INSERT INTO families (id, name) VALUES ($1,'F3')", [fam]);
      await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Dep','2015-01-01',true)", [mem, fam]);
      const a = await newAppointment("SCHEDULED", ids.clinic, mem, fam);
      await repo.insert(db, { id: randomUUID(), familyId: fam, memberId: mem, clinicId: ids.clinic, clinicName: "x", clinicAccountId: ids.account, appointmentId: a, text: "x", createdAt: new Date() });
      await pool.query("DELETE FROM family_members WHERE id = $1", [mem]);
      expect((await pool.query("SELECT 1 FROM recommendations WHERE member_id = $1", [mem])).rowCount).toBe(0);
    });
  });

  describe("caso de uso real sobre as repos reais (UC-REC-01/02)", () => {
    const clock = new FixedClock(new Date("2030-01-01T09:00:00Z"));
    const audit = new FakeAuditPort();
    const alerts = new FakeRecommendationAlertsPort();
    const memberNames = new FakeMemberNamesPort();
    const deps: RecommendationsDeps<Kysely<Database>> = {
      recommendationsRepo: repo,
      policy: new FakeAccessPolicy() as unknown as RecommendationsDeps<Kysely<Database>>["policy"],
      memberNames: memberNames as unknown as RecommendationsDeps<Kysely<Database>>["memberNames"],
      origins: {
        findAppointmentOfClinic: async (trx, clinicId, id) => {
          const o = await appointments.findByClinicId(trx, clinicId, id);
          return o ? { familyId: o.familyId, memberId: o.memberId, status: o.status, ...(o.clinicName ? { clinicName: o.clinicName } : {}) } : null;
        },
        findExaminationOfClinic: async (trx, clinicId, id) => {
          const o = await examinations.findByClinicId(trx, clinicId, id);
          return o ? { familyId: o.familyId, memberId: o.memberId, status: o.status, ...(o.clinicName ? { clinicName: o.clinicName } : {}) } : null;
        },
      },
      alerts: alerts as unknown as RecommendationsDeps<Kysely<Database>>["alerts"],
      audit: audit as unknown as RecommendationsDeps<Kysely<Database>>["audit"],
      withTransaction: (fn) => withTransaction(db, fn),
      clock,
    };
    const actor = { clinicAccountId: ids.account, clinicId: ids.clinic };
    const otherActor = { clinicAccountId: ids.otherAccount, clinicId: ids.otherClinic };

    it("grava, audita e alerta na mesma transação; outra clínica => NOT_FOUND; origem CANCELLED => CONFLICT; titular lê", async () => {
      memberNames.names.set(`${ids.family}:${ids.member}`, "Ana");
      const appointmentId = await newAppointment("SCHEDULED");
      const cancelled = await newAppointment("CANCELLED");
      const examinationId = await newExam("COMPLETED");
      const create = createCreateClinicRecommendationUseCase(deps);

      const view = await create(actor, { appointmentId, text: "  Repouso  " }, { requestId: "r1" });
      expect(view).toMatchObject({ appointmentId, patientName: "Ana", text: "Repouso" });
      await create(actor, { examinationId, text: "Repetir" }, { requestId: "r2" });
      await expect(create(otherActor, { appointmentId, text: "x" }, { requestId: "r3" })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(create(actor, { appointmentId: cancelled, text: "x" }, { requestId: "r4" })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(alerts.events.map((a) => a.recommendationId)).toContain(view.id);

      const saved = await pool.query("SELECT clinic_id, clinic_account_id, clinic_name, family_id, member_id FROM recommendations WHERE id = $1", [view.id]);
      expect(saved.rows[0]).toEqual({ clinic_id: ids.clinic, clinic_account_id: ids.account, clinic_name: "Clínica Sol", family_id: ids.family, member_id: ids.member });

      expect((await createListClinicRecommendationsUseCase(deps)(otherActor, {})).map((r) => r.id)).not.toContain(view.id);
      const page = await createListRecommendationsUseCase(deps)({ userId: ids.user, platformAdmin: false }, ids.family, ids.member, { appointmentId }, { requestId: "r5" });
      expect(page.items.map((r) => r.id)).toContain(view.id);
    });
  });
});
