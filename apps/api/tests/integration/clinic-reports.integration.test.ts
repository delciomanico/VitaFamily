// Integração real (testcontainers + PostgreSQL 16) da migração 0031 (M15 S/T, ADR-027, BR-CLN-41..50, TC-CLN-21..24): 1:1 por
// marcação, CHECKs, imutabilidade do FINAL por trigger (só `author_account_id -> NULL` tolerado), adendas imutáveis e limite de
// 20 sob concorrência, relatório que sobrevive ao apagamento do membro (sem FK), cascata da clínica, rascunho de exame, e
// `documents.generated_by_system` (CLEAN, só de exame, um por exame, fora do limite dos 5 PDF).
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createAddAddendumUseCase } from "../../src/modules/clinic-reports/application/clinic-reports.js";
import { createClinicReportsFixtures } from "../../src/modules/clinic-reports/application/fixtures.js";
import type { ReportRecord } from "../../src/modules/clinic-reports/application/ports.js";
import { KyselyReportsRepository } from "../../src/modules/clinic-reports/infrastructure/repo.js";
import { KyselyDocumentsRepository } from "../../src/modules/documents/infrastructure/repo.js";
import { KyselyExamResultsDraftRepository } from "../../src/modules/examinations/infrastructure/repo.js";

describe("integração: relatório da consulta, rascunho de resultados e laudo gerado (migração 0031)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let workDir: string;
  const reports = new KyselyReportsRepository();
  const documents = new KyselyDocumentsRepository();
  const drafts = new KyselyExamResultsDraftRepository();
  const clinicA = randomUUID();
  const clinicB = randomUUID();
  const NOW = new Date("2026-11-08T12:00:00.000Z");
  let legacyDocument: string;

  async function newMember() {
    const familyId = randomUUID(), userId = randomUUID(), memberId = randomUUID();
    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','Maria','1990-01-01','Europe/Lisbon','ACTIVE','1',now())", [userId, `${userId}@example.pt`]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam')", [familyId]);
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Maria','1990-01-01','FAMILY_ADMIN')", [memberId, familyId, userId]);
    return { familyId, memberId };
  }
  async function newAccount(clinicId: string) {
    const id = randomUUID();
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,$3,'x','CLINIC_MANAGER')", [id, clinicId, `${id}@c.pt`]);
    return id;
  }
  async function newExam(m: { familyId: string; memberId: string }, clinicId: string | null = null) {
    const id = randomUUID();
    await pool.query("INSERT INTO examinations (id, family_id, member_id, name, exam_date, status, clinic_id) VALUES ($1,$2,$3,'Análises','2026-11-08','SCHEDULED',$4)", [id, m.familyId, m.memberId, clinicId]);
    return id;
  }
  const record = (clinicId: string, overrides: Partial<ReportRecord> = {}): ReportRecord => ({
    id: randomUUID(),
    clinicId,
    bookingKind: "APPOINTMENT",
    bookingId: randomUUID(),
    clinicPatientId: null,
    status: "DRAFT",
    reason: "Dor lombar.",
    findings: null,
    impression: "Lombalgia.",
    plan: null,
    sharedWithPatient: true,
    patientName: "Maria Silva",
    patientBirthDate: "1990-03-04",
    consultationAt: NOW,
    specialty: "Medicina Geral",
    authorName: "Dr. João Costa",
    issuer: null,
    authorAccountId: "",
    finalizedAt: null,
    now: NOW,
    ...overrides,
  });
  const final = { status: "FINAL" as const, issuer: { name: "Clínica Sol", address: null, phone: null, email: null }, finalizedAt: NOW };
  async function save(clinicId: string, accountId: string, overrides: Partial<ReportRecord> = {}) {
    return withTransaction(db, (trx) => reports.upsert(trx, record(clinicId, { authorAccountId: accountId, ...overrides })));
  }

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);
    // 1.º passo: tudo até à 0030, com um documento existente (a coluna nova tem de ficar `false`).
    workDir = await mkdtemp(join(tmpdir(), "vita-mig-"));
    await mkdir(workDir, { recursive: true });
    for (const file of (await readdir(defaultMigrationsDir())).filter((f) => f.endsWith(".sql") && f < "0031")) {
      await copyFile(join(defaultMigrationsDir(), file), join(workDir, file));
    }
    await runMigrations(pool, workDir);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica Sol'), ($2,'PARTNER','Outra')", [clinicA, clinicB]);
    const m = await newMember();
    const exam = await newExam(m);
    legacyDocument = randomUUID();
    await pool.query("INSERT INTO documents (id, family_id, member_id, examination_id, storage_key, original_name, mime_type, size_bytes, checksum_sha256, scan_status) VALUES ($1,$2,$3,$4,'documents/old.pdf','a.pdf','application/pdf',10,'abc','CLEAN')", [legacyDocument, m.familyId, m.memberId, exam]);
    // 2.º passo: a migração do M15 sobre dados existentes.
    await runMigrations(pool, defaultMigrationsDir());
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("0031 aplicada numa só transação; documentos existentes ficam generated_by_system=false; sem backfill", async () => {
    expect((await pool.query("SELECT version FROM schema_migrations")).rows.map((r: { version: string }) => r.version)).toContain("0031_clinic_reports");
    expect((await pool.query("SELECT generated_by_system FROM documents WHERE id=$1", [legacyDocument])).rows[0]).toEqual({ generated_by_system: false });
    expect((await pool.query("SELECT 'DRAFT'::consultation_report_status::text AS s, 'VISIT'::consultation_booking_kind::text AS k")).rows[0]).toEqual({ s: "DRAFT", k: "VISIT" });
  });

  it("1:1 por marcação (UNIQUE clinic, kind, booking); a escrita repetida atualiza o rascunho (última escrita ganha)", async () => {
    const account = await newAccount(clinicA);
    const bookingId = randomUUID();
    const first = await save(clinicA, account, { bookingId });
    const second = await save(clinicA, account, { bookingId, reason: "Mudou", impression: null });
    expect(second?.id).toBe(first?.id);
    expect(second).toMatchObject({ reason: "Mudou", impression: null, status: "DRAFT" });
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_consultation_reports WHERE booking_id=$1", [bookingId])).rows[0]).toEqual({ n: 1 });
    // Mesma marcação em visita é outra chave; outra clínica também.
    await save(clinicA, account, { bookingId, bookingKind: "VISIT", sharedWithPatient: false });
    await save(clinicB, await newAccount(clinicB), { bookingId });
    await expect(pool.query("INSERT INTO clinic_consultation_reports (clinic_id, booking_kind, booking_id, reason, patient_name, author_name, consultation_at) VALUES ($1,'APPOINTMENT',$2,'x','M','A',now())", [clinicA, bookingId])).rejects.toThrow(/booking_key/);
  });

  it("CHECKs: ≥1 secção, limites, FINAL ⇔ finalized_at+issuer, visita nunca partilhada, nomes 1–120", async () => {
    const account = await newAccount(clinicA);
    const insert = (cols: string, vals: unknown[]) => pool.query(`INSERT INTO clinic_consultation_reports (clinic_id, booking_kind, booking_id, patient_name, author_name, consultation_at, ${cols}) VALUES ($1,'APPOINTMENT',$2,'M','A',now(), ${vals.map((_, i) => `$${String(i + 3)}`).join(",")})`, [clinicA, randomUUID(), ...vals]);
    await expect(pool.query("INSERT INTO clinic_consultation_reports (clinic_id, booking_kind, booking_id, patient_name, author_name, consultation_at) VALUES ($1,'APPOINTMENT',$2,'M','A',now())", [clinicA, randomUUID()])).rejects.toThrow(/sections_check/);
    for (const [col, max] of [["reason", 300], ["findings", 1500], ["impression", 500], ["plan", 1500]] as const) {
      await insert(col, ["a".repeat(max)]);
      await expect(insert(col, ["a".repeat(max + 1)])).rejects.toThrow(new RegExp(`${col}_check`));
    }
    await expect(insert("reason, status", ["x", "FINAL"])).rejects.toThrow(/final_check/);
    await expect(insert("reason, finalized_at, issuer", ["x", NOW, JSON.stringify({ name: "Clínica" })])).rejects.toThrow(/final_check/);
    await expect(pool.query("INSERT INTO clinic_consultation_reports (clinic_id, booking_kind, booking_id, reason, patient_name, author_name, consultation_at, shared_with_patient) VALUES ($1,'VISIT',$2,'x','M','A',now(), true)", [clinicA, randomUUID()])).rejects.toThrow(/visit_not_shared_check/);
    await expect(pool.query("INSERT INTO clinic_consultation_reports (clinic_id, booking_kind, booking_id, reason, patient_name, author_name, consultation_at) VALUES ($1,'APPOINTMENT',$2,'x','','A',now())", [clinicA, randomUUID()])).rejects.toThrow(/patient_name_check/);
    await expect(save(clinicA, account, { reason: null, impression: null })).rejects.toThrow(/sections_check/);
  });

  it("imutabilidade do FINAL: UPDATE direto de QUALQUER coluna falha; o rascunho edita-se; author_account_id -> NULL (ON DELETE SET NULL) tem sucesso; FINAL não regressa a DRAFT", async () => {
    const account = await newAccount(clinicA);
    const bookingId = randomUUID();
    await save(clinicA, account, { bookingId });
    const finalized = await save(clinicA, account, { bookingId, ...final });
    expect(finalized).toMatchObject({ status: "FINAL" });
    for (const set of ["reason='mudado'", "findings='x'", "impression=NULL", "plan='p'", "shared_with_patient=false", "patient_name='Outro'", "patient_birth_date=NULL", "consultation_at=now()", "specialty='x'", "author_name='Outro'", "issuer='{\"name\":\"X\"}'", "finalized_at=now()", "updated_at=now()", "status='DRAFT'", "clinic_patient_id=gen_random_uuid()", "booking_id=gen_random_uuid()"]) {
      await expect(pool.query(`UPDATE clinic_consultation_reports SET ${set} WHERE id=$1`, [finalized?.id]), set).rejects.toThrow(/imut/);
    }
    // Repetir o upsert sobre FINAL não escreve (WHERE status='DRAFT') e devolve null.
    expect(await save(clinicA, account, { bookingId, reason: "tentativa" })).toBeNull();
    expect((await pool.query("SELECT reason FROM clinic_consultation_reports WHERE id=$1", [finalized?.id])).rows[0]).toEqual({ reason: "Dor lombar." });
    // Remover a conta autora: ON DELETE SET NULL dispara o trigger de linha e é tolerado.
    await pool.query("DELETE FROM clinic_accounts WHERE id=$1", [account]);
    expect((await pool.query("SELECT author_account_id, author_name FROM clinic_consultation_reports WHERE id=$1", [finalized?.id])).rows[0]).toEqual({ author_account_id: null, author_name: "Dr. João Costa" });
    // O rascunho continua editável por UPDATE direto.
    const other = await newAccount(clinicA);
    const draft = await save(clinicA, other);
    await pool.query("UPDATE clinic_consultation_reports SET reason='ok' WHERE id=$1", [draft?.id]);
  });

  it("adendas: imutáveis (só author_account_id -> NULL), CHECK 1–1500, limite de 20 sob 25 pedidos concorrentes (FOR UPDATE do relatório)", async () => {
    const account = await newAccount(clinicA);
    const bookingId = randomUUID();
    await save(clinicA, account, { bookingId });
    const report = await save(clinicA, account, { bookingId, ...final });
    const f = createClinicReportsFixtures(new FixedClock(NOW));
    f.professionals.names.set(`${clinicA}|prof-1`, "Dr. João Costa");
    f.professionals.slots.set(`${clinicA}|slot-1`, "prof-1");
    f.bookings.seed("APPOINTMENT", bookingId, clinicA, { slotId: "slot-1", status: "COMPLETED" });
    const addendum = createAddAddendumUseCase({ ...f.deps, reportsRepo: reports, withTransaction: (fn) => withTransaction(db, fn), limiter: { consume: () => ({ allowed: true, retryAfterMs: 0 }) } });
    const actor = { clinicAccountId: account, clinicId: clinicA, role: "CLINIC_DOCTOR" as const, professionalId: "prof-1" };
    const results = await Promise.allSettled(Array.from({ length: 25 }, (_, i) => addendum(actor, bookingId, { text: `Adenda ${String(i)}` }, { requestId: "r" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(20);
    expect(results.filter((r) => r.status === "rejected").every((r) => ((r as { reason: { code?: string } }).reason).code === "LIMIT_EXCEEDED")).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_consultation_report_addenda WHERE report_id=$1", [report?.id])).rows[0]).toEqual({ n: 20 });
    const row = (await pool.query("SELECT id FROM clinic_consultation_report_addenda WHERE report_id=$1 LIMIT 1", [report?.id])).rows[0] as { id: string };
    for (const set of ["text='x'", "author_name='Outro'", "created_at=now()", "report_id=gen_random_uuid()"]) {
      await expect(pool.query(`UPDATE clinic_consultation_report_addenda SET ${set} WHERE id=$1`, [row.id]), set).rejects.toThrow(/imut|fk/);
    }
    await expect(pool.query("INSERT INTO clinic_consultation_report_addenda (clinic_id, report_id, text, author_name) VALUES ($1,$2,'','A')", [clinicA, report?.id])).rejects.toThrow(/text_check/);
    await expect(pool.query("INSERT INTO clinic_consultation_report_addenda (clinic_id, report_id, text, author_name) VALUES ($1,$2,$3,'A')", [clinicA, report?.id, "x".repeat(1501)])).rejects.toThrow(/text_check/);
    // FK composta: uma adenda não pode apontar para o relatório de outra clínica.
    await expect(pool.query("INSERT INTO clinic_consultation_report_addenda (clinic_id, report_id, text, author_name) VALUES ($1,$2,'x','A')", [clinicB, report?.id])).rejects.toThrow(/report_fk/);
    // Conta removida: a adenda mantém o retrato do nome.
    await pool.query("DELETE FROM clinic_accounts WHERE id=$1", [account]);
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_consultation_report_addenda WHERE report_id=$1 AND author_account_id IS NULL AND author_name='Dr. João Costa'", [report?.id])).rows[0]).toEqual({ n: 20 });
  });

  it("registo da clínica (BR-CLN-50): sem FK para appointments/clinic_visits/famílias; apagar o membro não apaga o relatório; apagar a clínica apaga relatório e adendas", async () => {
    const fks = (await pool.query("SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE contype='f' AND conrelid IN ('clinic_consultation_reports'::regclass, 'clinic_consultation_report_addenda'::regclass)")).rows.map((r: { target: string }) => r.target).sort();
    // Só `clinics` (CASCADE), `clinic_accounts` x2 (autoria, SET NULL), `clinic_patients` e o relatório (FK composta das adendas): nada de Vita.
    expect(fks).toEqual(["clinic_accounts", "clinic_accounts", "clinic_consultation_reports", "clinic_patients", "clinics"]);
    const m = await newMember();
    const appointmentId = randomUUID();
    await pool.query("INSERT INTO appointments (id, family_id, member_id, scheduled_at, status, clinic_id) VALUES ($1,$2,$3,now() + interval '1 day','SCHEDULED',$4)", [appointmentId, m.familyId, m.memberId, clinicA]);
    const account = await newAccount(clinicA);
    const report = await save(clinicA, account, { bookingId: appointmentId, ...final });
    await pool.query("DELETE FROM family_members WHERE id=$1", [m.memberId]);
    expect((await pool.query("SELECT count(*)::int AS n FROM appointments WHERE id=$1", [appointmentId])).rows[0]).toEqual({ n: 0 });
    const survived = await withTransaction(db, (trx) => reports.findByBooking(trx, clinicA, "APPOINTMENT", appointmentId));
    expect(survived).toMatchObject({ id: report?.id, status: "FINAL", patientName: "Maria Silva" });
    // Isolamento do repositório: outra clínica não encontra.
    expect(await withTransaction(db, (trx) => reports.findByBooking(trx, clinicB, "APPOINTMENT", appointmentId))).toBeNull();
    expect(await withTransaction(db, (trx) => reports.findByBookingId(trx, clinicB, appointmentId))).toBeNull();

    const clinic = randomUUID();
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Cascata')", [clinic]);
    const accountC = await newAccount(clinic);
    const cr = await save(clinic, accountC, { ...final });
    await pool.query("INSERT INTO clinic_consultation_report_addenda (clinic_id, report_id, text, author_name) VALUES ($1,$2,'x','A')", [clinic, cr?.id]);
    await pool.query("DELETE FROM clinics WHERE id=$1", [clinic]);
    expect((await pool.query("SELECT (SELECT count(*)::int FROM clinic_consultation_reports WHERE clinic_id=$1) AS r, (SELECT count(*)::int FROM clinic_consultation_report_addenda WHERE clinic_id=$1) AS a", [clinic])).rows[0]).toEqual({ r: 0, a: 0 });
  });

  it("paciente da clínica: FK composta só aceita clinic_patient_id da mesma clínica; estados e partilha por consulta", async () => {
    const patientB = randomUUID();
    await pool.query("INSERT INTO clinic_patients (id, clinic_id, name, name_norm, origin) VALUES ($1,$2,'Paciente B','paciente b','MANUAL')", [patientB, clinicB]);
    const account = await newAccount(clinicA);
    await expect(save(clinicA, account, { clinicPatientId: patientB })).rejects.toThrow(/patient_fk/);
    const ok = await save(clinicB, await newAccount(clinicB), { clinicPatientId: patientB, ...final });
    const shared = await save(clinicA, account, { ...final });
    const notShared = await save(clinicA, account, { ...final, sharedWithPatient: false });
    const visit = await save(clinicA, account, { ...final, bookingKind: "VISIT", sharedWithPatient: false });
    const ids = [shared, notShared, visit].map((r) => r?.bookingId ?? "");
    const available = await withTransaction(db, (trx) => reports.sharedFinalAppointments(trx, [...ids.map((bookingId) => ({ clinicId: clinicA, bookingId })), { clinicId: clinicB, bookingId: ok?.bookingId ?? "" }]));
    expect([...available].sort()).toEqual([shared?.bookingId ?? "", ok?.bookingId ?? ""].sort());
    // O par (clínica, marcação) conta: o id de uma clínica noutra clínica não aparece.
    expect((await withTransaction(db, (trx) => reports.sharedFinalAppointments(trx, [{ clinicId: clinicA, bookingId: ok?.bookingId ?? "" }]))).size).toBe(0);
    const statuses = await withTransaction(db, (trx) => reports.statusesByBookings(trx, clinicA, "APPOINTMENT", ids));
    expect([...statuses.values()]).toEqual(["FINAL", "FINAL"]);
  });

  it("rascunho de resultados de exame: CHECKs (array ≤50, nota ≤2000, conteúdo), um por exame (upsert), cascata com o exame; apagar o membro apaga-o", async () => {
    const m = await newMember();
    const exam = await newExam(m, clinicA);
    const account = await newAccount(clinicA);
    const items = [{ parameter: "Hemoglobina", valueNumeric: 11.2, unit: "g/dL", referenceMin: 12, referenceMax: 16 }];
    const saved = await withTransaction(db, (trx) => drafts.upsert(trx, { examinationId: exam, results: items, resultNote: null, clinicAccountId: account, now: NOW }));
    expect(saved).toMatchObject({ examinationId: exam, results: items, resultNote: null });
    const replaced = await withTransaction(db, (trx) => drafts.upsert(trx, { examinationId: exam, results: [], resultNote: "só nota", clinicAccountId: account, now: NOW }));
    expect(replaced).toMatchObject({ results: [], resultNote: "só nota" });
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_exam_result_drafts WHERE examination_id=$1", [exam])).rows[0]).toEqual({ n: 1 });
    expect(await withTransaction(db, (trx) => drafts.existingIds(trx, [exam, randomUUID()]))).toEqual(new Set([exam]));
    await expect(pool.query("UPDATE clinic_exam_result_drafts SET results='[]', result_note=NULL WHERE examination_id=$1", [exam])).rejects.toThrow(/content_check/);
    await expect(pool.query("UPDATE clinic_exam_result_drafts SET results='{}' WHERE examination_id=$1", [exam])).rejects.toThrow(/results_check|non-array/);
    await expect(pool.query("UPDATE clinic_exam_result_drafts SET results=$2::jsonb WHERE examination_id=$1", [exam, JSON.stringify(Array.from({ length: 51 }, () => ({ parameter: "x", valueNumeric: 1 })))])).rejects.toThrow(/results_check/);
    await expect(pool.query("UPDATE clinic_exam_result_drafts SET result_note=$2 WHERE examination_id=$1", [exam, "x".repeat(2001)])).rejects.toThrow(/note_check/);
    expect(await withTransaction(db, (trx) => drafts.delete(trx, exam))).toBe(true);
    expect(await withTransaction(db, (trx) => drafts.delete(trx, exam))).toBe(false);
    await withTransaction(db, (trx) => drafts.upsert(trx, { examinationId: exam, results: items, resultNote: null, clinicAccountId: account, now: NOW }));
    await pool.query("DELETE FROM family_members WHERE id=$1", [m.memberId]);
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_exam_result_drafts WHERE examination_id=$1", [exam])).rows[0]).toEqual({ n: 0 });
    // Apagar a conta autora só limpa a autoria (SET NULL).
    const exam2 = await newExam(await newMember(), clinicA);
    await withTransaction(db, (trx) => drafts.upsert(trx, { examinationId: exam2, results: items, resultNote: null, clinicAccountId: account, now: NOW }));
    await pool.query("DELETE FROM clinic_accounts WHERE id=$1", [account]);
    expect((await pool.query("SELECT updated_by_clinic_account_id FROM clinic_exam_result_drafts WHERE examination_id=$1", [exam2])).rows[0]).toEqual({ updated_by_clinic_account_id: null });
  });

  it("documents.generated_by_system: aceita o laudo CLEAN da clínica; rejeita uploaded_by, PENDING, sem exame; UNIQUE parcial um por exame; fora do limite de 5; coexiste com PDF carregado", async () => {
    const m = await newMember();
    const exam = await newExam(m);
    const account = await newAccount(clinicA);
    const base = (id: string, keySuffix: string) => ({ id, familyId: m.familyId, memberId: m.memberId, resourceType: "EXAMINATION" as const, resourceId: exam, storageKey: `documents/${id}${keySuffix}.pdf`, originalName: "laudo.pdf", mimeType: "application/pdf", sizeBytes: 100, checksumSha256: "abc", createdAt: NOW });
    const generated = await withTransaction(db, (trx) => documents.insert(trx, { ...base(randomUUID(), "g"), uploadedByClinic: true, uploadedByClinicAccountId: account, generatedBySystem: true }));
    expect(generated).toMatchObject({ scanStatus: "CLEAN", generatedBySystem: true, uploadedByClinic: true });
    expect(generated.uploadedBy).toBeUndefined();
    await expect(withTransaction(db, (trx) => documents.insert(trx, { ...base(randomUUID(), "g2"), uploadedByClinic: true, generatedBySystem: true }))).rejects.toThrow(/generated_exam_uq/);
    const insertRaw = (cols: string, vals: unknown[]) => pool.query(`INSERT INTO documents (family_id, member_id, storage_key, original_name, mime_type, size_bytes, checksum_sha256, generated_by_system, ${cols}) VALUES ($1,$2,'documents/z.pdf','a.pdf','application/pdf',10,'abc',true, ${vals.map((_, i) => `$${String(i + 3)}`).join(",")})`, [m.familyId, m.memberId, ...vals]);
    const exam2 = await newExam(m);
    await expect(insertRaw("examination_id, uploaded_by_clinic, scan_status", [exam2, true, "PENDING"])).rejects.toThrow(/generated_by_system_check/);
    await expect(insertRaw("examination_id, uploaded_by_clinic, scan_status, uploaded_by", [exam2, true, "CLEAN", ((await pool.query("SELECT user_id FROM family_members WHERE id=$1", [m.memberId])).rows[0] as { user_id: string }).user_id])).rejects.toThrow(/generated_by_system_check|uploader_exclusive|examination_only_check/);
    await expect(insertRaw("examination_id, uploaded_by_clinic, scan_status", [exam2, false, "CLEAN"])).rejects.toThrow(/generated_by_system_check/);
    await expect(insertRaw("examination_id, uploaded_by_clinic, scan_status", [null, true, "CLEAN"])).rejects.toThrow(/exactly_one_resource|generated_by_system_check|examination_only_check/);
    // Não conta para o limite de 5 PDF por exame.
    for (let i = 0; i < 5; i += 1) await withTransaction(db, (trx) => documents.insert(trx, { ...base(randomUUID(), `u${String(i)}`), uploadedByClinic: true, uploadedByClinicAccountId: account }));
    expect(await withTransaction(db, (trx) => documents.countByResource(trx, m.familyId, m.memberId, "EXAMINATION", exam))).toBe(5);
    expect((await withTransaction(db, (trx) => documents.listByResource(trx, m.familyId, m.memberId, "EXAMINATION", exam)))).toHaveLength(6);
    expect((await withTransaction(db, (trx) => documents.findGeneratedByExamination(trx, m.familyId, m.memberId, exam)))?.id).toBe(generated.id);
    expect(await withTransaction(db, (trx) => documents.findGeneratedByExamination(trx, m.familyId, m.memberId, exam2))).toBeNull();
    // O titular apaga o laudo (D15) e pode gerar-se outro (UNIQUE parcial livre).
    await withTransaction(db, (trx) => documents.delete(trx, m.familyId, m.memberId, generated.id));
    await withTransaction(db, (trx) => documents.insert(trx, { ...base(randomUUID(), "g3"), uploadedByClinic: true, generatedBySystem: true }));
    // Apagar o exame apaga os documentos (cascata D15).
    await pool.query("DELETE FROM examinations WHERE id=$1", [exam]);
    expect((await pool.query("SELECT count(*)::int AS n FROM documents WHERE examination_id=$1", [exam])).rows[0]).toEqual({ n: 0 });
  });
});
