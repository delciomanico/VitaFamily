// Integração real (testcontainers + PostgreSQL 16) da migração 0032 (M15 U, ADR-028, BR-CLN-51..56, TC-CLN-25/26): CHECKs, valor de enum
// `EXAM_ORDER_ADDED` depois do ADD VALUE, registo da clínica sem FK para consulta/exame/membro (a ponte é a única ligação a ids Vita),
// cascatas, UNIQUE parcial de `examination_id`, limite de 5 ativos sob concorrência (advisory lock), `ExamOrderLinker` e máscara `booked_here`.
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql, type Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createCancelExamOrderUseCase, createCreateExamOrdersUseCase, createListExamOrdersUseCase } from "../../src/modules/clinic-reports/application/exam-orders.js";
import { createExamOrderLinker, createListFamilyExamOrdersUseCase } from "../../src/modules/clinic-reports/application/family-exam-orders.js";
import { createClinicReportsFixtures } from "../../src/modules/clinic-reports/application/fixtures.js";
import type { ClinicReportsDeps } from "../../src/modules/clinic-reports/application/ports.js";
import { KyselyExamOrdersRepository } from "../../src/modules/clinic-reports/infrastructure/exam-orders-repo.js";

describe("integração: pedido de exame e ponte para o paciente (migração 0032)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let workDir: string;
  const repo = new KyselyExamOrdersRepository();
  const clinicA = randomUUID();
  const clinicB = randomUUID();
  const NOW = new Date("2026-11-10T12:00:00.000Z");
  const ctx = { requestId: "r" };

  async function newMember() {
    const familyId = randomUUID(), userId = randomUUID(), memberId = randomUUID();
    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','Maria','1990-01-01','Europe/Lisbon','ACTIVE','1',now())", [userId, `${userId}@example.pt`]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam')", [familyId]);
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Maria','1990-01-01','FAMILY_ADMIN')", [memberId, familyId, userId]);
    return { familyId, memberId, userId };
  }
  async function newAccount(clinicId: string) {
    const id = randomUUID();
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,$3,'x','CLINIC_MANAGER')", [id, clinicId, `${id}@c.pt`]);
    return id;
  }
  async function newAppointment(m: { familyId: string; memberId: string }, clinicId: string) {
    const id = randomUUID();
    await pool.query("INSERT INTO appointments (id, family_id, member_id, scheduled_at, status, clinic_id) VALUES ($1,$2,$3,now() + interval '1 day','SCHEDULED',$4)", [id, m.familyId, m.memberId, clinicId]);
    return id;
  }
  async function newExam(m: { familyId: string; memberId: string }, clinicId: string | null = null) {
    const id = randomUUID();
    await pool.query("INSERT INTO examinations (id, family_id, member_id, name, exam_date, status, clinic_id) VALUES ($1,$2,$3,'Análises','2026-11-20','SCHEDULED',$4)", [id, m.familyId, m.memberId, clinicId]);
    return id;
  }
  const insertOrder = (clinicId: string, bookingId: string, extra = "", values: unknown[] = []) =>
    pool.query(`INSERT INTO clinic_exam_orders (clinic_id, booking_kind, booking_id, name, patient_name, consultation_at, author_name${extra ? `, ${extra.split("|")[0] ?? ""}` : ""}) VALUES ($1,'APPOINTMENT',$2,'Hemograma','Maria Silva',now(),'Dr. João'${extra ? `, ${extra.split("|")[1] ?? ""}` : ""}) RETURNING id`, [clinicId, bookingId, ...values]);

  /** Casos de uso reais sobre a BD real; as restantes portas são os fakes das fixtures (a BD não tem outro papel aqui). */
  function realDeps(overrides: Partial<ClinicReportsDeps<Kysely<Database>>> = {}) {
    const f = createClinicReportsFixtures(new FixedClock(NOW));
    const deps = {
      ...(f.deps as unknown as ClinicReportsDeps<Kysely<Database>>),
      ordersRepo: repo,
      audit: { record: () => Promise.resolve() },
      withTransaction: <T>(fn: (trx: Kysely<Database>) => Promise<T>) => withTransaction(db, fn),
      limiter: { consume: () => ({ allowed: true, retryAfterMs: 0 }) },
      ...overrides,
    };
    return { f, deps };
  }

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita` });
    db = createDb(pool);
    // 1.º passo: tudo até à 0031; 2.º passo: a migração do M15 U sobre uma BD com dados (alerts existentes ficam intactos).
    workDir = await mkdtemp(join(tmpdir(), "vita-mig-"));
    await mkdir(workDir, { recursive: true });
    for (const file of (await readdir(defaultMigrationsDir())).filter((f) => f.endsWith(".sql") && f < "0032")) {
      await copyFile(join(defaultMigrationsDir(), file), join(workDir, file));
    }
    await runMigrations(pool, workDir);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica Sol'), ($2,'PARTNER','Outra')", [clinicA, clinicB]);
    await runMigrations(pool, defaultMigrationsDir());
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("0032 aplicada; o enum exam_order_status existe e o valor EXAM_ORDER_ADDED de alert_type aceita-se depois da migração", async () => {
    expect((await pool.query("SELECT version FROM schema_migrations")).rows.map((r: { version: string }) => r.version)).toContain("0032_clinic_exam_orders");
    expect((await pool.query("SELECT enum_range(NULL::exam_order_status)::text AS r")).rows[0]).toEqual({ r: "{ORDERED,SCHEDULED,FULFILLED,CANCELLED}" });
    const m = await newMember();
    const appointment = await newAppointment(m, clinicA);
    await pool.query("INSERT INTO alerts (recipient_user_id, family_id, member_id, type, source_type, source_id, rule_key, dedupe_key, trigger_at) VALUES ($1,$2,$3,'EXAM_ORDER_ADDED','APPOINTMENT',$4,'exam_order.added','k1',now())", [m.userId, m.familyId, m.memberId, appointment]);
    expect((await pool.query("SELECT type, source_type FROM alerts WHERE dedupe_key='k1'")).rows[0]).toEqual({ type: "EXAM_ORDER_ADDED", source_type: "APPOINTMENT" });
  });

  it("CHECKs: nome 1–80, nota ≤200, nomes de retrato 1–120, CANCELLED ⇔ cancelled_at, booked_here só em SCHEDULED/FULFILLED, defaults", async () => {
    const booking = randomUUID();
    const ok = (await insertOrder(clinicA, booking)).rows[0] as { id: string };
    expect((await pool.query("SELECT status, urgent, booked_here, note FROM clinic_exam_orders WHERE id=$1", [ok.id])).rows[0]).toEqual({ status: "ORDERED", urgent: false, booked_here: false, note: null });
    const bad = (cols: string, ...values: unknown[]) => insertOrder(clinicA, booking, cols, values);
    await expect(pool.query("INSERT INTO clinic_exam_orders (clinic_id, booking_kind, booking_id, name, patient_name, consultation_at, author_name) VALUES ($1,'APPOINTMENT',$2,'','M',now(),'A')", [clinicA, booking])).rejects.toThrow(/name_check/);
    await expect(pool.query("INSERT INTO clinic_exam_orders (clinic_id, booking_kind, booking_id, name, patient_name, consultation_at, author_name) VALUES ($1,'APPOINTMENT',$2,$3,'M',now(),'A')", [clinicA, booking, "a".repeat(81)])).rejects.toThrow(/name_check/);
    await expect(pool.query("INSERT INTO clinic_exam_orders (clinic_id, booking_kind, booking_id, name, patient_name, consultation_at, author_name) VALUES ($1,'APPOINTMENT',$2,$3,'M',now(),'A')", [clinicA, booking, "a".repeat(80)])).resolves.toBeDefined();
    await expect(bad("note|$3", "n".repeat(201))).rejects.toThrow(/note_check/);
    await expect(bad("note|$3", "n".repeat(200))).resolves.toBeDefined();
    await expect(pool.query("INSERT INTO clinic_exam_orders (clinic_id, booking_kind, booking_id, name, patient_name, consultation_at, author_name) VALUES ($1,'APPOINTMENT',$2,'x','',now(),'A')", [clinicA, booking])).rejects.toThrow(/patient_name_check/);
    await expect(pool.query("INSERT INTO clinic_exam_orders (clinic_id, booking_kind, booking_id, name, patient_name, consultation_at, author_name) VALUES ($1,'APPOINTMENT',$2,'x','M',now(),$3)", [clinicA, booking, "a".repeat(121)])).rejects.toThrow(/author_name_check/);
    await expect(bad("status|'CANCELLED'")).rejects.toThrow(/cancelled_check/);
    await expect(bad("cancelled_at|now()")).rejects.toThrow(/cancelled_check/);
    await expect(bad("status, cancelled_at|'CANCELLED', now()")).resolves.toBeDefined();
    await expect(bad("booked_here|true")).rejects.toThrow(/booked_here_check/);
    await expect(bad("booked_here, status|true, 'SCHEDULED'")).resolves.toBeDefined();
  });

  it("registo da clínica (BR-CLN-56): sem FK para appointments/clinic_visits/examinations/family_members; FK composta ao paciente e ao serviço da MESMA clínica", async () => {
    const fks = (await pool.query("SELECT confrelid::regclass::text AS target FROM pg_constraint WHERE contype='f' AND conrelid = 'clinic_exam_orders'::regclass")).rows.map((r: { target: string }) => r.target).sort();
    expect(fks).toEqual(["clinic_accounts", "clinic_accounts", "clinic_patients", "clinic_service_types", "clinics"]);
    // Um serviço de outra clínica não se liga ao pedido (FK composta).
    const service = randomUUID();
    await pool.query("INSERT INTO clinic_service_types (id, clinic_id, name, kind, duration_minutes) VALUES ($1,$2,'Eco','EXAM',30)", [service, clinicB]);
    await expect(insertOrder(clinicA, randomUUID(), "service_type_id|$3", [service])).rejects.toThrow(/service_fk/);
    await expect(insertOrder(clinicB, randomUUID(), "service_type_id|$3", [service])).resolves.toBeDefined();
  });

  it("apagar o membro/consulta apaga só a ponte e NÃO o pedido; apagar o exame ligado põe examination_id a nulo; UNIQUE parcial por exame", async () => {
    const m = await newMember();
    const appointment = await newAppointment(m, clinicA);
    const account = await newAccount(clinicA);
    const exam = await newExam(m);
    const { deps } = realDeps();
    const order = await withTransaction(db, (trx) =>
      repo.insert(trx, { id: randomUUID(), clinicId: clinicA, bookingKind: "APPOINTMENT", bookingId: appointment, clinicPatientId: null, name: "Hemograma", serviceTypeId: null, note: null, urgent: false, patientName: "Maria Silva", patientBirthDate: null, consultationAt: NOW, authorName: "Dr. João", authorAccountId: account, now: NOW }),
    );
    const second = await withTransaction(db, (trx) =>
      repo.insert(trx, { id: randomUUID(), clinicId: clinicA, bookingKind: "APPOINTMENT", bookingId: appointment, clinicPatientId: null, name: "Glicemia", serviceTypeId: null, note: null, urgent: true, patientName: "Maria Silva", patientBirthDate: null, consultationAt: NOW, authorName: "Dr. João", authorAccountId: account, now: NOW }),
    );
    for (const o of [order, second]) await withTransaction(db, (trx) => repo.insertLink(trx, { orderId: o.id, familyId: m.familyId, memberId: m.memberId, appointmentId: appointment }, NOW));
    await withTransaction(db, (trx) => repo.setLinked(trx, order.id, exam, "SCHEDULED", false, NOW));
    // um exame cumpre no máximo um pedido
    await expect(pool.query("UPDATE clinic_exam_order_links SET examination_id=$1 WHERE order_id=$2", [exam, second.id])).rejects.toThrow(/examination_uq/);
    // apagar o exame: SET NULL na ligação
    await pool.query("DELETE FROM examinations WHERE id=$1", [exam]);
    expect((await pool.query("SELECT examination_id FROM clinic_exam_order_links WHERE order_id=$1", [order.id])).rows[0]).toEqual({ examination_id: null });
    // apagar a consulta: a ponte desaparece, o pedido fica
    await pool.query("DELETE FROM appointments WHERE id=$1", [appointment]);
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_exam_order_links WHERE order_id = ANY($1)", [[order.id, second.id]])).rows[0]).toEqual({ n: 0 });
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_exam_orders WHERE id = ANY($1)", [[order.id, second.id]])).rows[0]).toEqual({ n: 2 });
    expect(deps).toBeDefined();
    // apagar o membro (e a família) também preserva o pedido (retrato do nome, sem ids Vita)
    const m2 = await newMember();
    const appointment2 = await newAppointment(m2, clinicA);
    const o2 = await withTransaction(db, (trx) =>
      repo.insert(trx, { id: randomUUID(), clinicId: clinicA, bookingKind: "APPOINTMENT", bookingId: appointment2, clinicPatientId: null, name: "Eco", serviceTypeId: null, note: null, urgent: false, patientName: "Maria Silva", patientBirthDate: null, consultationAt: NOW, authorName: "Dr. João", authorAccountId: account, now: NOW }),
    );
    await withTransaction(db, (trx) => repo.insertLink(trx, { orderId: o2.id, familyId: m2.familyId, memberId: m2.memberId, appointmentId: appointment2 }, NOW));
    await pool.query("DELETE FROM families WHERE id=$1", [m2.familyId]);
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_exam_order_links WHERE order_id=$1", [o2.id])).rows[0]).toEqual({ n: 0 });
    expect(await withTransaction(db, (trx) => repo.listByBooking(trx, clinicA, appointment2))).toHaveLength(1);
    // a conta do autor removida: o retrato do nome fica
    await pool.query("DELETE FROM clinic_accounts WHERE id=$1", [account]);
    expect((await pool.query("SELECT author_account_id, author_name FROM clinic_exam_orders WHERE id=$1", [o2.id])).rows[0]).toEqual({ author_account_id: null, author_name: "Dr. João" });
  });

  it("apagar a clínica apaga pedidos e pontes (cascata)", async () => {
    const clinic = randomUUID();
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Cascata')", [clinic]);
    const m = await newMember();
    const appointment = await newAppointment(m, clinic);
    const order = (await insertOrder(clinic, appointment)).rows[0] as { id: string };
    await pool.query("INSERT INTO clinic_exam_order_links (order_id, family_id, member_id, appointment_id) VALUES ($1,$2,$3,$4)", [order.id, m.familyId, m.memberId, appointment]);
    await pool.query("DELETE FROM appointments WHERE clinic_id=$1", [clinic]);
    await pool.query("DELETE FROM clinics WHERE id=$1", [clinic]);
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_exam_orders WHERE clinic_id=$1", [clinic])).rows[0]).toEqual({ n: 0 });
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_exam_order_links WHERE order_id=$1", [order.id])).rows[0]).toEqual({ n: 0 });
  });

  it("limite de 5 ativos por marcação sob 8 pedidos concorrentes (pg_advisory_xact_lock): exatamente 5 criados, 3 LIMIT_EXCEEDED", async () => {
    const account = await newAccount(clinicA);
    const bookingId = randomUUID();
    const { f, deps } = realDeps();
    f.professionals.names.set(`${clinicA}|prof-1`, "Dr. João Costa");
    f.professionals.slots.set(`${clinicA}|slot-1`, "prof-1");
    f.bookings.seed("VISIT", bookingId, clinicA, { slotId: "slot-1" });
    const create = createCreateExamOrdersUseCase(deps);
    const actor = { clinicAccountId: account, clinicId: clinicA, role: "CLINIC_DOCTOR" as const, professionalId: "prof-1" };
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => create(actor, bookingId, { items: [{ name: `Exame ${String(i)}` }] }, ctx)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as { reason: { code?: string } }).reason.code === "LIMIT_EXCEEDED")).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_exam_orders WHERE booking_id=$1 AND status <> 'CANCELLED'", [bookingId])).rows[0]).toEqual({ n: 5 });
    // cancelar liberta a vaga
    const first = (await pool.query("SELECT id FROM clinic_exam_orders WHERE booking_id=$1 LIMIT 1", [bookingId])).rows[0] as { id: string };
    await createCancelExamOrderUseCase(deps)(actor, bookingId, first.id, ctx);
    await expect(create(actor, bookingId, { items: [{ name: "Novo" }] }, ctx)).resolves.toHaveLength(6);
  });

  it("fluxo completo com BD real: criar (ponte+alerta) -> paciente liga -> máscara booked_here -> concluir -> apagar exame; cancelar desfaz a ligação sem tocar no exame", async () => {
    const m = await newMember();
    const account = await newAccount(clinicA);
    const appointment = await newAppointment(m, clinicA);
    const alerts: { appointmentId: string }[] = [];
    const { f, deps } = realDeps();
    f.professionals.names.set(`${clinicA}|prof-1`, "Dr. João Costa");
    f.professionals.slots.set(`${clinicA}|slot-1`, "prof-1");
    f.bookings.seed("APPOINTMENT", appointment, clinicA, { slotId: "slot-1", vitaMember: { familyId: m.familyId, memberId: m.memberId } });
    f.patientAccess.relations.set(`${m.userId}:${m.memberId}`, "SELF");
    deps.orderAlerts = { raiseExamOrderAdded: (_trx, input) => { alerts.push(input); return Promise.resolve(); } };
    const actor = { clinicAccountId: account, clinicId: clinicA, role: "CLINIC_DOCTOR" as const, professionalId: "prof-1" };
    const created = await createCreateExamOrdersUseCase(deps)(actor, appointment, { items: [{ name: "Hemograma", note: "Jejum", urgent: true }, { name: "Glicemia" }] }, ctx);
    // a mesma hora de criação nos dois: a ordem da lista desempata por id, por isso procuram-se por nome.
    const a = created.find((o) => o.name === "Hemograma");
    const b = created.find((o) => o.name === "Glicemia");
    expect(alerts).toEqual([{ appointmentId: appointment, familyId: m.familyId, memberId: m.memberId }]);
    const self = { userId: m.userId, platformAdmin: false };
    const family = createListFamilyExamOrdersUseCase(deps);
    expect((await family(self, m.familyId, m.memberId)).map((o) => [o.name, o.status, o.examinationId])).toEqual(expect.arrayContaining([["Hemograma", "ORDERED", null], ["Glicemia", "ORDERED", null]]));

    const linker = createExamOrderLinker(deps);
    const examA = await newExam(m, clinicA);
    const examB = await newExam(m, clinicB);
    await withTransaction(db, (trx) => linker.link(trx, { actor: self, familyId: m.familyId, memberId: m.memberId, orderId: a?.id ?? "", examinationId: examA, examClinicId: clinicA, status: "SCHEDULED" }, ctx));
    await withTransaction(db, (trx) => linker.link(trx, { actor: self, familyId: m.familyId, memberId: m.memberId, orderId: b?.id ?? "", examinationId: examB, examClinicId: clinicB, status: "SCHEDULED" }, ctx));
    // ligar de novo => CONFLICT; pedido de outro membro => NOT_FOUND
    await expect(withTransaction(db, (trx) => linker.link(trx, { actor: self, familyId: m.familyId, memberId: m.memberId, orderId: a?.id ?? "", examinationId: examA, status: "SCHEDULED" }, ctx))).rejects.toMatchObject({ code: "CONFLICT" });
    const stranger = await newMember();
    f.patientAccess.relations.set(`${stranger.userId}:${stranger.memberId}`, "SELF");
    await expect(withTransaction(db, (trx) => linker.link(trx, { actor: { userId: stranger.userId, platformAdmin: false }, familyId: stranger.familyId, memberId: stranger.memberId, orderId: a?.id ?? "", examinationId: examA, status: "SCHEDULED" }, ctx))).rejects.toMatchObject({ code: "NOT_FOUND" });

    // clínica de origem: A (booked_here) vê SCHEDULED; B (marcado noutra clínica) vê ORDERED
    const list = createListExamOrdersUseCase(deps);
    const seen = await list({ ...actor, role: "CLINIC_MANAGER" }, appointment, ctx);
    expect(seen.map((o) => [o.name, o.status]).sort()).toEqual([["Glicemia", "ORDERED"], ["Hemograma", "SCHEDULED"]]);
    // o paciente vê o estado real nos dois
    expect((await family(self, m.familyId, m.memberId)).map((o) => [o.name, o.status]).sort()).toEqual([["Glicemia", "SCHEDULED"], ["Hemograma", "SCHEDULED"]]);
    // a clínica B (destino) nunca vê o pedido
    const outsider = await newAccount(clinicB);
    await expect(list({ clinicAccountId: outsider, clinicId: clinicB, role: "CLINIC_MANAGER" }, appointment, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await withTransaction(db, (trx) => repo.listByBooking(trx, clinicB, appointment)))).toEqual([]);

    // concluir o exame de A => FULFILLED (visível, cancelar => 409); exame de B (fora) => FULFILLED mascarado como ORDERED
    await withTransaction(db, (trx) => linker.fulfil(trx, examA));
    await withTransaction(db, (trx) => linker.fulfil(trx, examB));
    expect((await list({ ...actor, role: "CLINIC_MANAGER" }, appointment, ctx)).map((o) => [o.name, o.status]).sort()).toEqual([["Glicemia", "ORDERED"], ["Hemograma", "FULFILLED"]]);
    await expect(createCancelExamOrderUseCase(deps)(actor, appointment, a?.id ?? "", ctx)).rejects.toMatchObject({ code: "INVALID_STATE_TRANSITION" });

    // cancelar o pedido noutra clínica (visível ORDERED): CANCELLED, ligação desfeita, o Examination fica
    const cancelled = await createCancelExamOrderUseCase(deps)(actor, appointment, b?.id ?? "", ctx);
    expect(cancelled.status).toBe("CANCELLED");
    expect((await pool.query("SELECT examination_id FROM clinic_exam_order_links WHERE order_id=$1", [b?.id])).rows[0]).toEqual({ examination_id: null });
    expect((await pool.query("SELECT count(*)::int AS n FROM examinations WHERE id=$1", [examB])).rows[0]).toEqual({ n: 1 });
    expect((await family(self, m.familyId, m.memberId)).map((o) => o.name)).toEqual(["Hemograma"]);
    expect((await family(self, m.familyId, m.memberId, { status: "CANCELLED" })).map((o) => o.name)).toEqual(["Glicemia"]);

    // exame apagado: release => ORDERED e booked_here=false; sem ligação, release/fulfil não fazem nada
    await withTransaction(db, async (trx) => {
      await linker.release(trx, examA);
      await sql`DELETE FROM examinations WHERE id = ${examA}`.execute(trx);
    });
    expect((await pool.query("SELECT status, booked_here FROM clinic_exam_orders WHERE id=$1", [a?.id])).rows[0]).toEqual({ status: "ORDERED", booked_here: false });
    await withTransaction(db, (trx) => linker.release(trx, examB));
    expect((await pool.query("SELECT status FROM clinic_exam_orders WHERE id=$1", [b?.id])).rows[0]).toEqual({ status: "CANCELLED" });
    // contagens para os decoradores
    expect((await withTransaction(db, (trx) => repo.activeCountsByAppointments(trx, [appointment]))).get(appointment)).toBe(1);
    expect((await withTransaction(db, (trx) => repo.activeCountsByBookings(trx, clinicA, [appointment]))).get(appointment)).toBe(1);
    expect((await withTransaction(db, (trx) => repo.activeCountsByBookings(trx, clinicB, [appointment]))).size).toBe(0);
  });
});

