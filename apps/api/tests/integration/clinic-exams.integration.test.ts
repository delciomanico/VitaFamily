// Integração real (testcontainers + PostgreSQL 16) das migrações 0018..0022 (ADR-023, D19 e revisão
// de 2026-11-04) e dos repositórios Kysely de `appointments`/`examinations`/`clinics`/`documents`:
//  - 0018: confirmar um pedido de consulta com horário já não viola a CHECK e o SET NULL funciona;
//  - 0021/0022: kind e capacity do horário, exames com vagas (marcação direta SCHEDULED), CHECKs de
//    emissão pela clínica corrigidas, `documents.uploaded_by_clinic` (schema.md §3);
//  - BR-APT-11: capacity+1 marcações simultâneas -> exatamente capacity sucessos (SELECT … FOR UPDATE);
//  - migração dos dados do fluxo retirado (REQUESTED/REJECTED -> CANCELLED) a partir de um esquema 0021.
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { createCreateExaminationUseCase } from "../../src/modules/examinations/application/create-examination.js";
import type { ExaminationsDeps } from "../../src/modules/examinations/application/ports.js";
import { createRemoveClinicSlotUseCase, createUpdateClinicSlotUseCase } from "../../src/modules/clinics/application/clinic-slots.js";
import type { ClinicsDeps } from "../../src/modules/clinics/application/ports.js";
import { KyselyAppointmentsRepository } from "../../src/modules/appointments/infrastructure/repo.js";
import { KyselyClinicSlotsRepository } from "../../src/modules/clinics/infrastructure/clinic-slots-repo.js";
import { KyselyDocumentsRepository } from "../../src/modules/documents/infrastructure/repo.js";
import { KyselyExamResultsRepository, KyselyExaminationsRepository } from "../../src/modules/examinations/infrastructure/repo.js";

describe("integração: migrações 0018..0022 e repositórios do portal da clínica (exames)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  const ids = { user: randomUUID(), family: randomUUID(), member: randomUUID(), clinic: randomUUID(), otherClinic: randomUUID(), account: randomUUID() };
  const appointments = new KyselyAppointmentsRepository();
  const examinations = new KyselyExaminationsRepository();
  const results = new KyselyExamResultsRepository();
  const slots = new KyselyClinicSlotsRepository();
  const documents = new KyselyDocumentsRepository();
  const FUTURE = new Date("2030-01-01T10:00:00Z");

  async function slot(kind: "APPOINTMENT" | "EXAM", clinicId = ids.clinic, capacity = 1): Promise<string> {
    const id = randomUUID();
    await slots.insert(db, { id, clinicId, kind, specialty: kind === "EXAM" ? "Ecografia" : "Cardiologia", startsAt: FUTURE, durationMinutes: 30, capacity, createdAt: new Date() });
    return id;
  }

  /** Membros extra (sem conta) da mesma família, para marcações simultâneas de pessoas distintas. */
  async function newMember(): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO family_members (id, family_id, name, birth_date, is_dependent) VALUES ($1,$2,'Dep','2015-01-01',true)", [id, ids.family]);
    return id;
  }

  async function newAppointment(slotId: string, status: "REQUESTED" | "SCHEDULED" = "REQUESTED") {
    const id = randomUUID();
    await appointments.insert(db, { id, familyId: ids.family, memberId: ids.member, scheduledAt: FUTURE, status, clinicId: ids.clinic, clinicName: "Clínica Sol", slotId, createdAt: new Date() });
    return id;
  }

  async function newExam(slotId: string | null, status: "SCHEDULED" | "COMPLETED" | "CANCELLED" = "SCHEDULED", memberId = ids.member) {
    const id = randomUUID();
    await examinations.insert(db, {
      id,
      familyId: ids.family,
      memberId,
      name: "Ecografia",
      examDate: "2030-01-01",
      status,
      clinicId: ids.clinic,
      clinicName: "Clínica Sol",
      createdAt: new Date(),
      ...(slotId ? { slotId, scheduledAt: FUTURE } : {}),
    });
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
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam')", [ids.family]);
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Ana','1990-01-01','FAMILY_ADMIN')", [ids.member, ids.family, ids.user]);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica Sol'), ($2,'PARTNER','Outra')", [ids.clinic, ids.otherClinic]);
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'c@c.pt','x','CLINIC_ADMIN')", [ids.account, ids.clinic]);
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("aplica 0018..0022 e regista-as; ClinicSlot.kind tem default APPOINTMENT e capacity default 1 para linhas antigas", async () => {
    const applied = await pool.query("SELECT version FROM schema_migrations WHERE version >= '0018' AND version < '0023' ORDER BY version");
    expect(applied.rows.map((r: { version: string }) => r.version)).toEqual([
      "0018_appointment_requested_slot_check_fix",
      "0019_exam_status_requested_rejected",
      "0020_alert_types_exam_responses",
      "0021_clinic_exams",
      "0022_exam_slot_capacity_and_issuer_checks",
    ]);
    const legacy = await pool.query("INSERT INTO clinic_slots (clinic_id, specialty, starts_at, duration_minutes) VALUES ($1,'Geral',$2,30) RETURNING kind, capacity", [ids.clinic, FUTURE]);
    expect(legacy.rows[0]).toEqual({ kind: "APPOINTMENT", capacity: 1 });
  });

  describe("0018: pedido de consulta com horário", () => {
    it("confirmar um REQUESTED com slot_id funciona (a CHECK antiga proibia SCHEDULED com slot)", async () => {
      const appointmentId = await newAppointment(await slot("APPOINTMENT"));
      const confirmed = await appointments.updateStatusByClinic(db, appointmentId, { status: "SCHEDULED" });
      expect(confirmed.status).toBe("SCHEDULED");
      expect(confirmed.slotId).toBeDefined();
      const completed = await appointments.completeByClinic(db, appointmentId, { clinicAccountId: ids.account, recordedAt: new Date(), outcomeNote: "ok" });
      expect(completed.status).toBe("COMPLETED");
    });

    it("recusar/cancelar mantém o slot_id e eliminar o horário (SET NULL) continua a funcionar", async () => {
      const slotId = await slot("APPOINTMENT");
      const rejected = await newAppointment(slotId);
      await appointments.updateStatusByClinic(db, rejected, { status: "REJECTED", responseNote: "sem vaga" });
      await slots.delete(db, slotId);
      const after = await appointments.findByClinicId(db, ids.clinic, rejected);
      expect(after).toMatchObject({ status: "REJECTED" });
      expect(after?.slotId).toBeUndefined();
    });

    it("um REQUESTED sem horário continua proibido; o horário continua a aceitar só uma marcação ativa", async () => {
      await expect(pool.query("INSERT INTO appointments (family_id, member_id, scheduled_at, status) VALUES ($1,$2,now(),'REQUESTED')", [ids.family, ids.member])).rejects.toThrow(/requested_requires_slot/);
      const slotId = await slot("APPOINTMENT");
      await newAppointment(slotId);
      await expect(newAppointment(slotId)).rejects.toThrow();
    });
  });

  describe("0022: exames com vagas e marcação direta (BR-APT-11)", () => {
    it("vários exames SCHEDULED no mesmo horário (sem UNIQUE por horário); contagem e ocupação por horário", async () => {
      const slotId = await slot("EXAM", ids.clinic, 3);
      const m2 = await newMember();
      const first = await newExam(slotId);
      await newExam(slotId, "SCHEDULED", m2);
      expect(await examinations.countScheduledBySlot(db, [slotId])).toEqual([{ slotId, count: 2 }]);
      expect(await examinations.existsScheduledForMember(db, slotId, ids.member)).toBe(true);
      expect(await examinations.existsScheduledForMember(db, slotId, randomUUID())).toBe(false);

      // Cancelar liberta a vaga; COMPLETED também não ocupa.
      await examinations.updateStatusByClinic(db, first, { status: "CANCELLED", responseNote: "x" });
      expect(await examinations.countScheduledBySlot(db, [slotId])).toEqual([{ slotId, count: 1 }]);
    });

    it("o mesmo membro não ocupa duas vagas do mesmo horário (UNIQUE parcial -> CONFLICT); depois de cancelar pode voltar", async () => {
      const slotId = await slot("EXAM", ids.clinic, 5);
      const first = await newExam(slotId);
      await expect(newExam(slotId)).rejects.toMatchObject({ code: "CONFLICT" });
      await examinations.updateStatus(db, ids.family, ids.member, first, "CANCELLED");
      await expect(newExam(slotId)).resolves.toBeDefined();
    });

    it("CHECKs: capacity 1–50; consulta só 1 vaga; REQUESTED/REJECTED proibidos; slot exige clínica; nota da clínica exige CLINIC", async () => {
      await expect(pool.query("INSERT INTO clinic_slots (clinic_id, kind, specialty, starts_at, duration_minutes, capacity) VALUES ($1,'EXAM','x',$2,30,0)", [ids.clinic, FUTURE])).rejects.toThrow(/capacity_range/);
      await expect(pool.query("INSERT INTO clinic_slots (clinic_id, kind, specialty, starts_at, duration_minutes, capacity) VALUES ($1,'EXAM','x',$2,30,51)", [ids.clinic, FUTURE])).rejects.toThrow(/capacity_range/);
      await expect(pool.query("INSERT INTO clinic_slots (clinic_id, kind, specialty, starts_at, duration_minutes, capacity) VALUES ($1,'APPOINTMENT','x',$2,30,2)", [ids.clinic, FUTURE])).rejects.toThrow(/capacity_kind/);
      await expect(pool.query("INSERT INTO clinic_slots (clinic_id, kind, specialty, starts_at, duration_minutes, capacity) VALUES ($1,'EXAM','x',$2,30,50)", [ids.clinic, FUTURE])).resolves.toBeDefined();

      const examId = await newExam(null, "SCHEDULED");
      await expect(pool.query("UPDATE examinations SET status = 'REQUESTED' WHERE id = $1", [examId])).rejects.toThrow(/no_request_flow/);
      await expect(pool.query("UPDATE examinations SET status = 'REJECTED' WHERE id = $1", [examId])).rejects.toThrow(/no_request_flow/);
      await expect(pool.query("INSERT INTO examinations (family_id, member_id, name, exam_date, status, slot_id) VALUES ($1,$2,'x','2030-01-01','SCHEDULED',$3)", [ids.family, ids.member, await slot("EXAM")])).rejects.toThrow(/slot_requires_clinic/);
      await expect(pool.query("UPDATE examinations SET clinic_result_note = 'x' WHERE id = $1", [examId])).rejects.toThrow(/clinic_result_note/);
    });

    it("fluxo SCHEDULED -> COMPLETED pela clínica com resultados e rastreabilidade; isolamento por clínica", async () => {
      const slotId = await slot("EXAM");
      const examId = await newExam(slotId);
      expect((await examinations.listByClinicAndStatus(db, ids.clinic, ["SCHEDULED"], {})).map((e) => e.id)).toContain(examId);
      expect(await examinations.listByClinicAndStatus(db, ids.otherClinic, ["SCHEDULED"], {})).toEqual([]);
      expect(await examinations.findByClinicId(db, ids.otherClinic, examId)).toBeNull();

      await results.insert(db, { id: randomUUID(), examinationId: examId, parameter: "Glicemia", valueNumeric: 250, unit: "mg/dL", referenceMin: 70, referenceMax: 100, createdAt: new Date() });
      const issuedAt = new Date();
      const completed = await examinations.completeByClinic(db, examId, { clinicAccountId: ids.account, issuedAt, resultNote: "nota" });
      expect(completed).toMatchObject({ status: "COMPLETED", issuedBy: "CLINIC", issuedByClinicAccountId: ids.account, clinicResultNote: "nota" });
      expect(await examinations.isCompleted(db, ids.family, ids.member, examId)).toBe(true);
      expect(await examinations.isCompleted(db, ids.family, randomUUID(), examId)).toBe(false);
    });

    it("eliminar um horário sem marcações ativas deixa os exames CANCELLED/COMPLETED com slot_id NULL (SET NULL) e scheduled_at", async () => {
      const slotId = await slot("EXAM");
      const examId = await newExam(slotId);
      await examinations.updateStatusByClinic(db, examId, { status: "CANCELLED", responseNote: "x" });
      await slots.delete(db, slotId);
      const after = await examinations.findById(db, ids.family, ids.member, examId);
      expect(after).toMatchObject({ status: "CANCELLED", responseNote: "x" });
      expect(after?.slotId).toBeUndefined();
      expect(after?.scheduledAt).toBeDefined();
    });

    it("documentos: marca permanente uploaded_by_clinic; CHECKs de coerência com autor, exame e uploaded_by", async () => {
      const examId = await newExam(await slot("EXAM"), "SCHEDULED");
      const doc = await documents.insert(db, {
        id: randomUUID(),
        familyId: ids.family,
        memberId: ids.member,
        resourceType: "EXAMINATION",
        resourceId: examId,
        storageKey: `quarantine/${randomUUID()}.pdf`,
        originalName: "r.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        checksumSha256: "abc",
        uploadedByClinic: true,
        uploadedByClinicAccountId: ids.account,
        createdAt: new Date(),
      });
      expect(doc).toMatchObject({ scanStatus: "PENDING", uploadedByClinic: true, uploadedByClinicAccountId: ids.account });
      expect(doc.uploadedBy).toBeUndefined();

      await expect(pool.query("UPDATE documents SET uploaded_by = $1 WHERE id = $2", [ids.user, doc.id])).rejects.toThrow(/uploader_exclusive|examination_only/);
      await expect(pool.query("UPDATE documents SET uploaded_by_clinic = false WHERE id = $1", [doc.id])).rejects.toThrow(/requires_flag/);
      await expect(
        pool.query("INSERT INTO documents (family_id, member_id, prescription_id, storage_key, original_name, mime_type, size_bytes, checksum_sha256, uploaded_by_clinic) VALUES ($1,$2,$3,$4,'a','application/pdf',1,'x',true)", [ids.family, ids.member, randomUUID(), `k/${randomUUID()}`]),
      ).rejects.toThrow();
    });

    it("remover a conta da clínica que emitiu resultados/receitas/PDF NÃO falha (SET NULL respeita as CHECK) e o PDF continua marcado como da clínica", async () => {
      const account = randomUUID();
      await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,$3,'x','CLINIC_MANAGER')", [account, ids.clinic, `m-${account}@c.pt`]);
      // Exame emitido pela clínica + PDF carregado por essa conta.
      const examId = await newExam(await slot("EXAM"), "SCHEDULED");
      await examinations.completeByClinic(db, examId, { clinicAccountId: account, issuedAt: new Date(), resultNote: null });
      const docId = randomUUID();
      await documents.insert(db, { id: docId, familyId: ids.family, memberId: ids.member, resourceType: "EXAMINATION", resourceId: examId, storageKey: `q/${docId}.pdf`, originalName: "r.pdf", mimeType: "application/pdf", sizeBytes: 5, checksumSha256: "x", uploadedByClinic: true, uploadedByClinicAccountId: account, createdAt: new Date() });
      // Receita emitida pela clínica numa consulta.
      const apptId = await newAppointment(await slot("APPOINTMENT"), "SCHEDULED");
      const rxId = randomUUID();
      await pool.query("INSERT INTO prescriptions (id, family_id, member_id, issued_on, issued_by, issued_by_clinic_account_id, appointment_id) VALUES ($1,$2,$3,current_date,'CLINIC',$4,$5)", [rxId, ids.family, ids.member, account, apptId]);

      await expect(pool.query("DELETE FROM clinic_accounts WHERE id = $1", [account])).resolves.toBeDefined();

      const exam = await pool.query("SELECT issued_by, issued_by_clinic_account_id FROM examinations WHERE id = $1", [examId]);
      expect(exam.rows[0]).toEqual({ issued_by: "CLINIC", issued_by_clinic_account_id: null });
      const rx = await pool.query("SELECT issued_by, issued_by_clinic_account_id FROM prescriptions WHERE id = $1", [rxId]);
      expect(rx.rows[0]).toEqual({ issued_by: "CLINIC", issued_by_clinic_account_id: null });
      const doc = await documents.findById(db, ids.family, ids.member, docId);
      expect(doc).toMatchObject({ uploadedByClinic: true });
      expect(doc?.uploadedByClinicAccountId).toBeUndefined();
    });

    // Corrigido na 0022 (ponto 6): o SET NULL da conta já não viola a CHECK do resultado.
    it("remover a conta que registou o resultado de uma consulta (appointments) funciona e mantém o resultado", async () => {
      const account = randomUUID();
      await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,$3,'x','CLINIC_MANAGER')", [account, ids.clinic, `a-${account}@c.pt`]);
      const apptId = await newAppointment(await slot("APPOINTMENT"), "SCHEDULED");
      await appointments.completeByClinic(db, apptId, { clinicAccountId: account, recordedAt: new Date(), outcomeNote: "ok" });
      await pool.query("DELETE FROM clinic_accounts WHERE id = $1", [account]);
      const { rows } = await pool.query("SELECT clinic_outcome_note, outcome_recorded_by_clinic_account_id FROM appointments WHERE id = $1", [apptId]);
      expect(rows[0]).toEqual({ clinic_outcome_note: "ok", outcome_recorded_by_clinic_account_id: null });
    });

    it("kind: o repositório de horários filtra por kind, devolve capacity, e a duplicação considera o kind", async () => {
      await slots.insert(db, { id: randomUUID(), clinicId: ids.otherClinic, kind: "EXAM", specialty: "Geral", startsAt: FUTURE, durationMinutes: 30, capacity: 7, createdAt: new Date() });
      const exams = await slots.listByClinic(db, ids.otherClinic, { kind: "EXAM" });
      expect(exams).toHaveLength(1);
      expect(exams[0]?.capacity).toBe(7);
      expect(await slots.listByClinic(db, ids.otherClinic, { kind: "APPOINTMENT" })).toHaveLength(0);
      expect(await slots.existsDuplicate(db, ids.otherClinic, { kind: "EXAM", startsAt: FUTURE, specialty: "Geral" })).toBe(true);
      expect(await slots.existsDuplicate(db, ids.otherClinic, { kind: "APPOINTMENT", startsAt: FUTURE, specialty: "Geral" })).toBe(false);
    });
  });

  describe("concorrência de marcação (BR-APT-11): SELECT … FOR UPDATE do horário", () => {
    function examDeps(): ExaminationsDeps<Kysely<Database>> {
      const clock = new FixedClock(new Date("2029-12-01T10:00:00Z"));
      return {
        examinationsRepo: examinations,
        examResultsRepo: results,
        policy: { can: () => Promise.resolve({} as never) },
        memberNames: { getMemberName: () => Promise.resolve("x") },
        alerts: { raiseExamEvent: () => Promise.resolve(0) },
        clinics: { getBookableClinic: (_trx, _familyId, clinicId) => Promise.resolve({ id: clinicId, name: "Clínica Sol" }), lockSlot: (trx, slotId) => slots.lockById(trx, slotId) },
        documents: { listForResource: () => Promise.resolve([]) } as unknown as ExaminationsDeps<Kysely<Database>>["documents"],
        audit: { record: () => Promise.resolve() },
        db,
        withTransaction: (fn) => withTransaction(db, fn),
        clock,
      };
    }

    async function bookAll(slotId: string, members: string[]) {
      const create = createCreateExaminationUseCase(examDeps());
      return Promise.allSettled(members.map((memberId) => create({ userId: ids.user, platformAdmin: false }, ids.family, memberId, { name: "x", examDate: "2030-01-01", slotId }, { requestId: randomUUID() })));
    }

    it.each([1, 3, 10])("capacity %i: capacity+1 marcações simultâneas (membros distintos) -> exatamente capacity sucessos, o resto CONFLICT", async (capacity) => {
      const slotId = await slot("EXAM", ids.clinic, capacity);
      const members = await Promise.all(Array.from({ length: capacity + 1 }, () => newMember()));

      const outcomes = await bookAll(slotId, members);

      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(capacity);
      const rejected = outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]?.reason).toMatchObject({ code: "CONFLICT" });
      expect(await examinations.countScheduledBySlot(db, [slotId])).toEqual([{ slotId, count: capacity }]);
    });

    it("o mesmo membro a marcar o mesmo horário N vezes em simultâneo -> 1 sucesso, resto CONFLICT (sem 500)", async () => {
      const slotId = await slot("EXAM", ids.clinic, 5);
      const member = await newMember();
      const outcomes = await bookAll(slotId, [member, member, member, member]);
      expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
      for (const o of outcomes.filter((o): o is PromiseRejectedResult => o.status === "rejected")) {
        expect(o.reason).toMatchObject({ code: "CONFLICT" });
      }
    });

    it("PATCH capacity vs marcações simultâneas e DELETE vs marcação: nunca fica capacity < marcações nem horário apagado com marcações", async () => {
      const clinicsDeps = {
        clinicSlotsRepo: slots,
        slotOccupancy: {
          countActiveBySlot: async (trx: Kysely<Database>, slotIds: string[]) => (await examinations.countScheduledBySlot(trx, slotIds)).map((r) => ({ slotId: r.slotId, requested: 0, scheduled: r.count })),
        },
        audit: { record: () => Promise.resolve() },
        withTransaction: (fn: (trx: Kysely<Database>) => Promise<unknown>) => withTransaction(db, fn),
        clock: new FixedClock(new Date("2029-12-01T10:00:00Z")),
      } as unknown as ClinicsDeps<Kysely<Database>>;
      const actor = { clinicAccountId: ids.account, clinicId: ids.clinic, role: "CLINIC_ADMIN" as const };
      const update = createUpdateClinicSlotUseCase(clinicsDeps);
      const remove = createRemoveClinicSlotUseCase(clinicsDeps);

      for (let round = 0; round < 5; round++) {
        const slotId = await slot("EXAM", ids.clinic, 4);
        const members = await Promise.all(Array.from({ length: 4 }, () => newMember()));
        const [, , patch] = await Promise.all([bookAll(slotId, members), Promise.resolve(), update(actor, slotId, { capacity: 2 }, { requestId: "r" }).then(() => "ok", (e: unknown) => e)]);
        const [{ count } = { count: 0 }] = await examinations.countScheduledBySlot(db, [slotId]);
        const current = (await slots.findById(db, slotId))?.capacity ?? 0;
        expect(count).toBeLessThanOrEqual(current);
        if (patch !== "ok") expect(patch).toMatchObject({ code: "CONFLICT" });
      }

      const slotId = await slot("EXAM", ids.clinic, 2);
      const member = await newMember();
      const [, removal] = await Promise.all([bookAll(slotId, [member]), remove(actor, slotId, { requestId: "r" }).then(() => "removed", (e: unknown) => e)]);
      const stillThere = await slots.findById(db, slotId);
      const [{ count } = { count: 0 }] = await examinations.countScheduledBySlot(db, [slotId]);
      // Ou o horário foi removido sem marcações, ou ficou com a marcação e o DELETE deu CONFLICT.
      if (removal === "removed") {
        expect(stillThere).toBeNull();
        expect(count).toBe(0);
      } else {
        expect(removal).toMatchObject({ code: "CONFLICT" });
        expect(stillThere).not.toBeNull();
        expect(count).toBe(1);
      }
    });
  });

  describe("0022 sobre dados do fluxo retirado (esquema 0021 migrado)", () => {
    it("converte REQUESTED/REJECTED em CANCELLED, apaga alertas EXAM_CONFIRMED/REJECTED, troca o índice, faz backfill de uploaded_by_clinic", async () => {
      const dir = await mkdtemp(join(tmpdir(), "vita-mig-"));
      for (const file of (await readdir(defaultMigrationsDir())).filter((f) => f.endsWith(".sql") && f < "0022")) {
        await copyFile(join(defaultMigrationsDir(), file), join(dir, file));
      }
      await pool.query("CREATE DATABASE legacy");
      const legacy = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/legacy` });
      try {
        await runMigrations(legacy, dir);
        const u = randomUUID();
        const f = randomUUID();
        const m = randomUUID();
        const c = randomUUID();
        const acc = randomUUID();
        await legacy.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1,'l@b.pt','x','L','1990-01-01','Europe/Lisbon','1',now())", [u]);
        await legacy.query("INSERT INTO families (id, name) VALUES ($1,'F')", [f]);
        await legacy.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'L','1990-01-01','FAMILY_ADMIN')", [m, f, u]);
        await legacy.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','C')", [c]);
        await legacy.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'x@c.pt','x','CLINIC_ADMIN')", [acc, c]);
        const s1 = randomUUID();
        const s2 = randomUUID();
        const s3 = randomUUID();
        for (const sid of [s1, s2, s3]) {
          await legacy.query("INSERT INTO clinic_slots (id, clinic_id, kind, specialty, starts_at, duration_minutes) VALUES ($1,$2,'EXAM','Eco',$3,30)", [sid, c, FUTURE]);
        }
        const ex = async (status: string, slotId: string, note: string | null = null) => {
          const id = randomUUID();
          await legacy.query("INSERT INTO examinations (id, family_id, member_id, name, exam_date, status, clinic_id, slot_id, scheduled_at, response_note) VALUES ($1,$2,$3,'Eco','2030-01-01',$4,$5,$6,$7,$8)", [id, f, m, status, c, slotId, FUTURE, note]);
          return id;
        };
        const requested = await ex("REQUESTED", s1);
        const rejected = await ex("REJECTED", s2, "sem vaga");
        const scheduled = await ex("SCHEDULED", s3);
        const doc = async (examId: string, extra: string, uploadedBy: string | null, clinicAcc: string | null) => {
          const id = randomUUID();
          await legacy.query(`INSERT INTO documents (id, family_id, member_id, examination_id, storage_key, original_name, mime_type, size_bytes, checksum_sha256, uploaded_by, uploaded_by_clinic_account_id) VALUES ($1,$2,$3,$4,$5,'a','application/pdf',1,'x',$6,$7)`, [id, f, m, examId, `k/${extra}/${id}`, uploadedBy, clinicAcc]);
          return id;
        };
        const clinicDoc = await doc(scheduled, "a", null, acc);
        const orphanDoc = await doc(scheduled, "b", null, null); // autor já anulado por SET NULL
        const familyDoc = await doc(scheduled, "c", u, null);
        await legacy.query("INSERT INTO alerts (recipient_user_id, family_id, member_id, type, source_type, source_id, rule_key, dedupe_key, trigger_at) VALUES ($1,$2,$3,'EXAM_CONFIRMED','EXAMINATION',$4,'exam.confirmed','d1',now()), ($1,$2,$3,'EXAM_CANCELLED','EXAMINATION',$4,'exam.cancelled','d2',now())", [u, f, m, requested]);

        await runMigrations(legacy, defaultMigrationsDir());

        const rows = await legacy.query("SELECT id, status, response_note FROM examinations WHERE id = ANY($1)", [[requested, rejected, scheduled]]);
        const byId = new Map((rows.rows as { id: string; status: string; response_note: string | null }[]).map((r) => [r.id, r]));
        expect(byId.get(requested)).toMatchObject({ status: "CANCELLED", response_note: "Pedido descontinuado" });
        expect(byId.get(rejected)).toMatchObject({ status: "CANCELLED", response_note: "sem vaga" });
        expect(byId.get(scheduled)).toMatchObject({ status: "SCHEDULED" });
        expect((await legacy.query("SELECT type FROM alerts ORDER BY type")).rows).toEqual([{ type: "EXAM_CANCELLED" }]);
        expect((await legacy.query("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'examinations_slot_active_booking_idx'")).rows[0]).toEqual({ n: 0 });
        const flags = await legacy.query("SELECT id, uploaded_by_clinic FROM documents WHERE id = ANY($1)", [[clinicDoc, orphanDoc, familyDoc]]);
        const flagOf = new Map((flags.rows as { id: string; uploaded_by_clinic: boolean }[]).map((r) => [r.id, r.uploaded_by_clinic]));
        expect(flagOf.get(clinicDoc)).toBe(true);
        expect(flagOf.get(orphanDoc)).toBe(true);
        expect(flagOf.get(familyDoc)).toBe(false);
        // Pós-migração: eliminar a conta (SET NULL) já não viola nada e o PDF mantém a marca.
        await legacy.query("DELETE FROM clinic_accounts WHERE id = $1", [acc]);
        expect((await legacy.query("SELECT uploaded_by_clinic, uploaded_by_clinic_account_id FROM documents WHERE id = $1", [clinicDoc])).rows[0]).toEqual({ uploaded_by_clinic: true, uploaded_by_clinic_account_id: null });
      } finally {
        await legacy.end();
      }
    }, 120_000);
  });
});
