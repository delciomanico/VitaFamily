// Integração real (testcontainers + PostgreSQL 16) das leituras mínimas partilhadas de MK4 (TC-MKT-124, BR-MKT-68, OP-119):
//  - as leituras públicas dos módulos (`families`, `healthRecords`, `medications`, `appointments`, `examinations`) sobre a BD real,
//    instanciadas com o mínimo de dependências (as que as leituras não tocam são `{} as never`);
//  - a composição `createSharedRecordsReader`, montada como em `main/api.ts` (nenhuma leitura é reimplementada aqui);
//  - idade em anos completos em Africa/Luanda (véspera e aniversário) e nenhuma data de nascimento, nome, nota ou id no resultado.
import { randomUUID } from "node:crypto";
import type { Kysely, Transaction } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { createAccessModule } from "../../src/modules/access/index.js";
import { createAppointmentsModule, type AppointmentsModule } from "../../src/modules/appointments/index.js";
import { createAuditModule } from "../../src/modules/audit/index.js";
import { createExaminationsModule, type ExaminationsModule } from "../../src/modules/examinations/index.js";
import { createFamiliesModule, type FamiliesModule } from "../../src/modules/families/index.js";
import { createHealthRecordsModule, type HealthRecordsModule } from "../../src/modules/health-records/index.js";
import { createMedicationsModule, type MedicationsModule } from "../../src/modules/medications/index.js";
import { createSharedRecordsReader, type SharedRecordsReader, type SharedRecordsSources } from "../../src/modules/record-sharing/application/shared-records.js";
import type { DataCategory } from "../../src/modules/record-sharing/domain/index.js";
import { createUsersModule } from "../../src/modules/users/index.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";

type Tx = Transaction<Database>;

/** Instante fixo: 2026-11-20 11:00 em Luanda (UTC+1). A janela de 24 meses começa em 2024-11-20. */
const NOW = new Date("2026-11-20T10:00:00Z");
const SINCE_24M = "2024-11-20";
const BIRTH = "1985-01-01";
const CANARY_NAME = "Canario Membro";
/** Sem dependências: as leituras aqui testadas não lhes tocam (ver comentário no topo). */
const UNUSED = {} as never;

describe("integração: leituras mínimas partilhadas (MK4, TC-MKT-124, BR-MKT-68)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let families: FamiliesModule;
  let healthRecords: HealthRecordsModule;
  let medications: MedicationsModule;
  let appointments: AppointmentsModule;
  let examinations: ExaminationsModule;
  let reader: SharedRecordsReader<Tx>;

  // Famílias e membros. M1 é o membro «canário» (nome e data de nascimento não podem sair).
  const F1 = randomUUID();
  const F2 = randomUUID();
  const M1 = randomUUID();
  const M2 = randomUUID();
  const M3 = randomUUID();
  const M4 = randomUUID();
  /** Ids internos semeados: nenhum pode aparecer no JSON devolvido. */
  const secretIds: string[] = [F1, F2, M1, M2, M3, M4];

  async function insertMember(id: string, familyId: string, name: string, birthDate: string, bloodType: string | null): Promise<void> {
    await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent, blood_type) VALUES ($1,$2,$3,$4,true,$5)", [id, familyId, name, birthDate, bloodType]);
  }

  async function insertAllergy(memberId: string, familyId: string, name: string, notes: string | null, since: string | null): Promise<void> {
    const { rows } = await pool.query<{ id: string }>("INSERT INTO allergies (family_id, member_id, name, notes, since) VALUES ($1,$2,$3,$4,$5) RETURNING id", [familyId, memberId, name, notes, since]);
    secretIds.push(...rows.map((r) => r.id));
  }

  async function insertCondition(memberId: string, familyId: string, name: string, kind: "CONDITION" | "HISTORY", notes: string | null, since: string | null, until: string | null): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO medical_conditions (family_id, member_id, name, kind, notes, since, until) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [familyId, memberId, name, kind, notes, since, until],
    );
    secretIds.push(...rows.map((r) => r.id));
  }

  async function insertPlan(p: { familyId: string; memberId: string; name: string; dosage: string; times: string[]; startAt: string; endAt: string | null; continuous: boolean; status: "ACTIVE" | "ENDED"; notes?: string }): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO medication_plans (family_id, member_id, name, dosage, schedule_type, times, start_at, end_at, continuous, notes, status, ended_at) VALUES ($1,$2,$3,$4,'FIXED_TIMES',$5,$6,$7,$8,$9,$10,$11) RETURNING id",
      [p.familyId, p.memberId, p.name, p.dosage, p.times, p.startAt, p.endAt, p.continuous, p.notes ?? null, p.status, p.status === "ENDED" ? p.endAt : null],
    );
    secretIds.push(...rows.map((r) => r.id));
  }

  async function insertAppointment(a: { familyId: string; memberId: string; scheduledAt: string; status: string; specialty?: string; professionalName?: string; notes?: string; reason?: string; responseNote?: string; createdAt?: string }): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO appointments (family_id, member_id, scheduled_at, status, specialty, professional_name, notes, reason, response_note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz, now())) RETURNING id",
      [a.familyId, a.memberId, a.scheduledAt, a.status, a.specialty ?? null, a.professionalName ?? null, a.notes ?? null, a.reason ?? null, a.responseNote ?? null, a.createdAt ?? null],
    );
    secretIds.push(...rows.map((r) => r.id));
  }

  async function insertExam(e: { familyId: string; memberId: string; name: string; examDate: string; status: "SCHEDULED" | "COMPLETED" | "CANCELLED"; notes?: string; responseNote?: string }): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO examinations (family_id, member_id, name, exam_date, status, notes, response_note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [e.familyId, e.memberId, e.name, e.examDate, e.status, e.notes ?? null, e.responseNote ?? null],
    );
    const id = rows[0]?.id ?? "";
    secretIds.push(id);
    return id;
  }

  async function insertResult(examinationId: string, r: { parameter: string; valueNumeric?: number; valueText?: string; unit?: string; referenceMin?: number; referenceMax?: number; createdAt: string }): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      "INSERT INTO exam_results (examination_id, parameter, value_numeric, value_text, unit, reference_min, reference_max, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz) RETURNING id",
      [examinationId, r.parameter, r.valueNumeric ?? null, r.valueText ?? null, r.unit ?? null, r.referenceMin ?? null, r.referenceMax ?? null, r.createdAt],
    );
    secretIds.push(...rows.map((x) => x.id));
  }

  /** Lê tudo numa transação (as leituras recebem `trx`). */
  function inTx<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
    return withTransaction(db, fn);
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

    // Módulos reais, com o mínimo de dependências (mesmo padrão de `tests/support/consultations-harness.ts`).
    const clock = new FixedClock(NOW);
    const audit = createAuditModule({ db, clock });
    const users = createUsersModule({ db, audit, clock, currentTermsVersion: "1" });
    families = createFamiliesModule({
      db,
      audit,
      users,
      clock,
      mailer: { send: () => Promise.resolve() },
      appBaseUrl: "https://vitafamily.cassfrei.com",
      memberData: { purgeMemberFiles: () => Promise.resolve(), purgeFamilyFiles: () => Promise.resolve(), exportBeforeRemoval: () => Promise.reject(new Error("não usado")) },
    });
    const access = createAccessModule({ db, audit, families, clock });
    healthRecords = createHealthRecordsModule({ db, audit, access, families, clock });
    medications = createMedicationsModule({ db, audit, access, clock });
    appointments = createAppointmentsModule({
      db,
      walkInRateLimiter: UNUSED,
      audit,
      access,
      clinics: UNUSED,
      examSlotOccupancy: UNUSED,
      prescriptions: UNUSED,
      patients: UNUSED,
      clinicPatients: UNUSED,
      receipts: UNUSED,
      consultationReports: UNUSED,
      completionReceipts: UNUSED,
      processes: UNUSED,
      clock,
    });
    examinations = createExaminationsModule({
      db,
      rateLimiter: UNUSED,
      audit,
      access,
      clinics: UNUSED,
      documents: UNUSED,
      alerts: UNUSED,
      receipts: UNUSED,
      reportGenerator: UNUSED,
      examOrders: UNUSED,
      processes: UNUSED,
      clock,
    });

    // Composição como em `main/api.ts` (bloco `createSharedRecordsReader`).
    const sources: SharedRecordsSources<Tx> = {
      birthDate: async (trx, familyId, memberId) => (await families.findMemberById(trx, familyId, memberId))?.birthDate ?? null,
      bloodType: (trx, familyId, memberId) => families.getBloodType(trx, familyId, memberId),
      allergies: (trx, familyId, memberId) => healthRecords.listSharedAllergies(trx, familyId, memberId),
      conditions: (trx, familyId, memberId) => healthRecords.listSharedConditions(trx, familyId, memberId),
      activeMedications: (trx, familyId, memberId) => medications.listActivePlansForSharing(trx, familyId, memberId),
      appointments: (trx, familyId, memberId, since) => appointments.listSharedAppointments(trx, familyId, memberId, since),
      examinations: (trx, familyId, memberId, since) => examinations.listSharedExams(trx, familyId, memberId, since),
    };
    reader = createSharedRecordsReader<Tx>(sources);

    // Dados semeados por SQL. Cada registo tem notas e campos extra (que nunca podem sair).
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Familia Leituras'), ($2,'Outra familia')", [F1, F2]);
    await insertMember(M1, F1, CANARY_NAME, BIRTH, "A_POS");
    await insertMember(M2, F1, "Outro Membro", "2015-01-01", null);
    await insertMember(M3, F2, "Outra Pessoa", "1980-05-05", "O_NEG");
    await insertMember(M4, F1, "Membro Volume", "1990-05-05", null);

    await insertAllergy(M1, F1, "Penicilina", "NOTA-CANARIO-ALERGIA", "2019-03-01");
    await insertAllergy(M1, F1, "Amendoim", null, null);
    await insertAllergy(M2, F1, "Latex", "NOTA-OUTRO-MEMBRO", "2020-01-01");

    await insertCondition(M1, F1, "Hipertensao", "CONDITION", "NOTA-CANARIO-CONDICAO", "2020-01-01", null);
    await insertCondition(M1, F1, "Apendicite", "HISTORY", "NOTA-CANARIO-HISTORIA", "2010-01-01", "2010-02-01");
    await insertCondition(M2, F1, "Asma", "CONDITION", null, null, null);

    await insertPlan({ familyId: F1, memberId: M1, name: "Losartan", dosage: "50 mg", times: ["08:00"], startAt: "2026-01-01T00:00:00Z", endAt: null, continuous: true, status: "ACTIVE", notes: "NOTA-CANARIO-MEDICACAO" });
    await insertPlan({ familyId: F1, memberId: M1, name: "Amoxicilina", dosage: "500 mg", times: ["08:00", "20:00"], startAt: "2026-10-01T00:00:00Z", endAt: "2027-01-01T00:00:00Z", continuous: false, status: "ACTIVE" });
    await insertPlan({ familyId: F1, memberId: M1, name: "Metformina", dosage: "850 mg", times: ["09:00"], startAt: "2025-01-01T00:00:00Z", endAt: "2026-06-01T00:00:00Z", continuous: false, status: "ENDED" });
    await insertPlan({ familyId: F1, memberId: M2, name: "Plano Outro Membro", dosage: "10 mg", times: ["07:00"], startAt: "2026-01-01T00:00:00Z", endAt: null, continuous: true, status: "ACTIVE" });
    await insertPlan({ familyId: F2, memberId: M3, name: "Plano Outra Familia", dosage: "5 mg", times: ["07:00"], startAt: "2026-01-01T00:00:00Z", endAt: null, continuous: true, status: "ACTIVE" });

    // Consultas: 25 meses (fora), 23 meses (dentro), futura (dentro); outro membro e outra família (fora).
    await insertAppointment({ familyId: F1, memberId: M1, scheduledAt: "2024-10-20T09:00:00Z", status: "COMPLETED", specialty: "Clinica Geral", professionalName: "Dr. Antigo", notes: "NOTA-ANTIGA" });
    await insertAppointment({ familyId: F1, memberId: M1, scheduledAt: "2024-12-20T09:00:00Z", status: "COMPLETED", specialty: "Cardiologia", professionalName: "Dra. Profissional Teste", notes: "NOTA-CANARIO-CONSULTA", reason: "MOTIVO-CANARIO" });
    await insertAppointment({ familyId: F1, memberId: M1, scheduledAt: "2027-03-10T09:30:00Z", status: "SCHEDULED", specialty: "Dermatologia", professionalName: "Dr. Futuro", responseNote: "RESP-CANARIO-CONSULTA" });
    await insertAppointment({ familyId: F1, memberId: M2, scheduledAt: "2027-01-05T10:00:00Z", status: "SCHEDULED", specialty: "Pediatria", professionalName: "Prof Outro Membro", notes: "NOTA-OUTRO-MEMBRO" });
    await insertAppointment({ familyId: F2, memberId: M3, scheduledAt: "2027-01-06T10:00:00Z", status: "SCHEDULED", specialty: "Ortopedia", professionalName: "Prof Outra Familia" });

    // Exames: fora da janela (2024-11-19), limite inclusivo (2024-11-20), recente, futuro; cancelado fora; outro membro/família fora.
    await insertExam({ familyId: F1, memberId: M1, name: "Fora da janela", examDate: "2024-11-19", status: "COMPLETED", notes: "NOTA-FORA" });
    await insertExam({ familyId: F1, memberId: M1, name: "Limite", examDate: "2024-11-20", status: "COMPLETED" });
    const hemograma = await insertExam({ familyId: F1, memberId: M1, name: "Hemograma", examDate: "2025-06-15", status: "COMPLETED", notes: "NOTA-CANARIO-EXAME", responseNote: "RESP-CANARIO-EXAME" });
    await insertResult(hemograma, { parameter: "Hemoglobina", valueNumeric: 13.5, unit: "g/dL", referenceMin: 12, referenceMax: 16, createdAt: "2025-06-15T10:00:00Z" });
    await insertResult(hemograma, { parameter: "Glicose", valueText: "normal", createdAt: "2025-06-15T10:01:00Z" });
    await insertExam({ familyId: F1, memberId: M1, name: "Cancelado", examDate: "2026-12-01", status: "CANCELLED", notes: "NOTA-CANCELADO" });
    await insertExam({ familyId: F1, memberId: M1, name: "Ecografia", examDate: "2027-02-01", status: "SCHEDULED" });
    await insertExam({ familyId: F1, memberId: M2, name: "Exame Outro Membro", examDate: "2026-03-01", status: "COMPLETED" });
    await insertExam({ familyId: F2, memberId: M3, name: "Exame Outra Familia", examDate: "2026-03-01", status: "COMPLETED" });
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  describe("(a) chaves mínimas e isolamento por membro", () => {
    it("alergias só com nome e desde; tipo sanguíneo lido do membro (null sem valor)", async () => {
      const allergies = await inTx((trx) => healthRecords.listSharedAllergies(trx, F1, M1));
      expect(allergies.map((a) => Object.keys(a).sort())).toEqual(allergies.map(() => ["name", "since"]));
      expect(allergies.map((a) => a.name).sort()).toEqual(["Amendoim", "Penicilina"]);
      expect(allergies.find((a) => a.name === "Penicilina")).toEqual({ name: "Penicilina", since: "2019-03-01" });
      expect(allergies.find((a) => a.name === "Amendoim")).toEqual({ name: "Amendoim", since: null });
      expect(await inTx((trx) => families.getBloodType(trx, F1, M1))).toBe("A_POS");
      expect(await inTx((trx) => families.getBloodType(trx, F1, M2))).toBeNull();
    });

    it("condições só com nome, tipo, desde e até", async () => {
      const conditions = await inTx((trx) => healthRecords.listSharedConditions(trx, F1, M1));
      expect(conditions.map((c) => Object.keys(c).sort())).toEqual(conditions.map(() => ["kind", "name", "since", "until"]));
      expect(conditions.find((c) => c.name === "Hipertensao")).toEqual({ name: "Hipertensao", kind: "CONDITION", since: "2020-01-01", until: null });
      expect(conditions.find((c) => c.name === "Apendicite")).toEqual({ name: "Apendicite", kind: "HISTORY", since: "2010-01-01", until: "2010-02-01" });
    });

    it("consultas só com data/hora, estado, especialidade e profissional; dos últimos 24 meses e futuras", async () => {
      const rows = await inTx((trx) => appointments.listSharedAppointments(trx, F1, M1, new Date(`${SINCE_24M}T00:00:00+01:00`)));
      expect(rows.map((r) => Object.keys(r).sort())).toEqual(rows.map(() => ["professionalName", "scheduledAt", "specialty", "status"]));
      expect(rows.map((r) => ({ ...r, scheduledAt: r.scheduledAt.toISOString() }))).toEqual([
        { scheduledAt: "2024-12-20T09:00:00.000Z", status: "COMPLETED", specialty: "Cardiologia", professionalName: "Dra. Profissional Teste" },
        { scheduledAt: "2027-03-10T09:30:00.000Z", status: "SCHEDULED", specialty: "Dermatologia", professionalName: "Dr. Futuro" },
      ]);
    });

    it("exames só com nome, data, estado e resultados; sem notas, resposta nem documento", async () => {
      const exams = await inTx((trx) => examinations.listSharedExams(trx, F1, M1, SINCE_24M));
      expect(exams.map((e) => Object.keys(e).sort())).toEqual(exams.map(() => ["examDate", "name", "results", "status"]));
      expect(exams.map((e) => e.results.map((r) => Object.keys(r).sort())).flat()).toEqual([
        ["parameter", "referenceMax", "referenceMin", "unit", "valueNumeric", "valueText"],
        ["parameter", "referenceMax", "referenceMin", "unit", "valueNumeric", "valueText"],
      ]);
    });

    it("isolamento: consultas e exames de outro membro (mesma família) e de outra família não aparecem", async () => {
      const apps = await inTx((trx) => appointments.listSharedAppointments(trx, F1, M1, new Date(`${SINCE_24M}T00:00:00+01:00`)));
      expect(apps.map((a) => a.professionalName)).not.toContain("Prof Outro Membro");
      expect(apps.map((a) => a.professionalName)).not.toContain("Prof Outra Familia");
      const exams = await inTx((trx) => examinations.listSharedExams(trx, F1, M1, SINCE_24M));
      expect(exams.map((e) => e.name)).not.toContain("Exame Outro Membro");
      expect(exams.map((e) => e.name)).not.toContain("Exame Outra Familia");
      // Mesmo membro id numa família errada não devolve nada (o par família+membro é a chave).
      expect(await inTx((trx) => healthRecords.listSharedAllergies(trx, F2, M1))).toEqual([]);
    });
  });

  describe("(b) medicação: só planos ativos", () => {
    it("ENDED fica de fora; só ACTIVE, com nome, dosagem, início, fim e contínua", async () => {
      const plans = await inTx((trx) => medications.listActivePlansForSharing(trx, F1, M1));
      expect(plans.map((p) => Object.keys(p).sort())).toEqual(plans.map(() => ["continuous", "dosage", "endAt", "name", "startAt"]));
      expect(plans.map((p) => p.name).sort()).toEqual(["Amoxicilina", "Losartan"]);
      expect(plans.find((p) => p.name === "Losartan")).toEqual({ name: "Losartan", dosage: "50 mg", startAt: new Date("2026-01-01T00:00:00Z"), endAt: null, continuous: true });
      expect(plans.find((p) => p.name === "Amoxicilina")).toEqual({ name: "Amoxicilina", dosage: "500 mg", startAt: new Date("2026-10-01T00:00:00Z"), endAt: new Date("2027-01-01T00:00:00Z"), continuous: false });
    });

    it("estados reais do esquema: plan_status só tem ACTIVE e ENDED (PAUSED e CANCELLED são rejeitados pela BD)", async () => {
      for (const bad of ["PAUSED", "CANCELLED"]) {
        await expect(
          pool.query("INSERT INTO medication_plans (family_id, member_id, name, dosage, schedule_type, times, start_at, continuous, status) VALUES ($1,$2,'x','x','FIXED_TIMES',$3,now(),true,$4)", [F1, M1, ["08:00"], bad]),
        ).rejects.toThrow();
      }
    });
  });

  describe("(c) consultas: janela de 24 meses e futuras", () => {
    it("entram há 23 meses e a futura; ficam de fora há 25 meses", async () => {
      const rows = await inTx((trx) => appointments.listSharedAppointments(trx, F1, M1, new Date(`${SINCE_24M}T00:00:00+01:00`)));
      const times = rows.map((r) => r.scheduledAt.toISOString());
      expect(times).toContain("2024-12-20T09:00:00.000Z");
      expect(times).toContain("2027-03-10T09:30:00.000Z");
      expect(times).not.toContain("2024-10-20T09:00:00.000Z");
    });
  });

  describe("(d) exames: janela de 24 meses, cancelados fora, resultados mínimos", () => {
    it("antigo fora, limite inclusivo dentro, cancelado fora; recente e futuro dentro, com resultados", async () => {
      const exams = await inTx((trx) => examinations.listSharedExams(trx, F1, M1, SINCE_24M));
      expect(exams.map((e) => e.name).sort()).toEqual(["Ecografia", "Hemograma", "Limite"]);
      const hemograma = exams.find((e) => e.name === "Hemograma");
      expect(hemograma).toEqual({
        name: "Hemograma",
        examDate: "2025-06-15",
        status: "COMPLETED",
        results: [
          { parameter: "Hemoglobina", valueNumeric: 13.5, valueText: null, unit: "g/dL", referenceMin: 12, referenceMax: 16 },
          { parameter: "Glicose", valueNumeric: null, valueText: "normal", unit: null, referenceMin: null, referenceMax: null },
        ],
      });
      expect(exams.find((e) => e.name === "Ecografia")).toEqual({ name: "Ecografia", examDate: "2027-02-01", status: "SCHEDULED", results: [] });
    });
  });

  describe("(e) composição createSharedRecordsReader sobre as leituras reais", () => {
    it("só ALLERGIES: devolve ageYears, allergies e bloodType; as outras secções são omitidas (não null)", async () => {
      const content = await inTx((trx) => reader.read(trx, { familyId: F1, memberId: M1, categories: ["ALLERGIES"], now: NOW }));
      expect(Object.keys(content).sort()).toEqual(["ageYears", "allergies", "bloodType"]);
      expect(content.ageYears).toBe(41);
      expect(content.bloodType).toBe("A_POS");
      expect(content.allergies?.map((a) => a.name).sort()).toEqual(["Amendoim", "Penicilina"]);
      // `since` ausente (não null) quando a alergia não tem data.
      expect(content.allergies?.find((a) => a.name === "Amendoim")).toEqual({ name: "Amendoim" });
    });

    it("com as 5 categorias: devolve as 5 secções, cada uma com as chaves mínimas", async () => {
      const categories: readonly DataCategory[] = ["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"];
      const content = await inTx((trx) => reader.read(trx, { familyId: F1, memberId: M1, categories, now: NOW }));
      expect(Object.keys(content).sort()).toEqual(["ageYears", "allergies", "appointments", "bloodType", "conditions", "examinations", "medications"]);
      expect(content.medications?.map((m) => Object.keys(m).sort())).toEqual(content.medications?.map(() => ["continuous", "dosage", "endAt", "name", "startAt"]));
      expect(content.medications?.find((m) => m.name === "Losartan")?.startAt).toBe("2026-01-01T00:00:00.000Z");
      expect(content.appointments?.map((a) => Object.keys(a).sort())).toEqual(content.appointments?.map(() => ["professionalName", "scheduledAt", "specialty", "status"]));
      expect(content.examinations?.map((e) => Object.keys(e).sort())).toEqual(content.examinations?.map(() => ["examDate", "name", "results", "status"]));
    });

    it("sem categorias concedidas: só ageYears", async () => {
      const content = await inTx((trx) => reader.read(trx, { familyId: F1, memberId: M1, categories: [], now: NOW }));
      expect(Object.keys(content)).toEqual(["ageYears"]);
    });

    it("ageYears em Africa/Luanda: véspera e aniversário de 1985-01-01 (2026-01-01 em Luanda)", async () => {
      // Véspera: 2025-12-31 22:59 UTC = 2025-12-31 23:59 em Luanda -> ainda 40 anos.
      const eve = await inTx((trx) => reader.read(trx, { familyId: F1, memberId: M1, categories: [], now: new Date("2025-12-31T22:59:00Z") }));
      expect(eve.ageYears).toBe(40);
      // Aniversário: 2025-12-31 23:01 UTC = 2026-01-01 00:01 em Luanda (em UTC ainda é 31 de dezembro) -> 41 anos.
      const birthday = await inTx((trx) => reader.read(trx, { familyId: F1, memberId: M1, categories: [], now: new Date("2025-12-31T23:01:00Z") }));
      expect(birthday.ageYears).toBe(41);
    });

    it("data de nascimento, nome, notas, motivos, respostas e ids nunca aparecem no JSON devolvido", async () => {
      const content = await inTx((trx) =>
        reader.read(trx, { familyId: F1, memberId: M1, categories: ["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"], now: NOW }),
      );
      const json = JSON.stringify(content);
      for (const forbidden of [BIRTH, CANARY_NAME, "NOTA-", "MOTIVO-", "RESP-", "Membro Volume", "Outro Membro", ...secretIds]) {
        expect(json).not.toContain(forbidden);
      }
    });
  });

  describe("defeito a confirmar: limite de 200 consultas da janela", () => {
    it("uma consulta futura criada depois de 200 consultas da janela não pode ser cortada (módulo diz «até 200, por data»)", async () => {
      // 200 consultas de 2025 criadas antes; a futura é criada por último. `listByMember` ordena por `created_at` e corta em 200.
      await pool.query(
        "INSERT INTO appointments (family_id, member_id, scheduled_at, status, created_at) SELECT $1, $2, '2025-02-01T00:00:00Z'::timestamptz + g * interval '1 minute', 'SCHEDULED', '2025-01-01T00:00:00Z'::timestamptz + g * interval '1 minute' FROM generate_series(1, 200) AS g",
        [F1, M4],
      );
      await insertAppointment({ familyId: F1, memberId: M4, scheduledAt: "2027-04-01T10:00:00Z", status: "SCHEDULED", specialty: "Oncologia", professionalName: "Dr. Recente", createdAt: "2026-11-01T00:00:00Z" });
      const rows = await inTx((trx) => appointments.listSharedAppointments(trx, F1, M4, new Date(`${SINCE_24M}T00:00:00+01:00`)));
      expect(rows.map((r) => r.scheduledAt.toISOString())).toContain("2027-04-01T10:00:00.000Z");
    });
  });
});
