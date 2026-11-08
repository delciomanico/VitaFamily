// Integração real (testcontainers + PostgreSQL 16) de pacientes da clínica (M14 P, migração 0028, BR-CLN-17..24,
// TC-CLN-08..12): constraints, cascatas (membro/conta/família/clínica), consumo concorrente do código, concorrência
// visita×consulta Vita, expiração do consentimento, apagamento do membro e job de limpeza.
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { createCreateWalkInAppointmentUseCase } from "../../src/modules/appointments/application/clinic-walk-in.js";
import type { AppointmentsDeps } from "../../src/modules/appointments/application/ports.js";
import { WalkInInMemoryRateLimiter } from "../../src/modules/appointments/domain/walk-in.js";
import { KyselyAppointmentsRepository } from "../../src/modules/appointments/infrastructure/repo.js";
import { createClinicGlobalSearchUseCase } from "../../src/modules/clinic-patients/application/calendar.js";
import { createCreateClinicLinkCodeUseCase, createPutClinicConsentUseCase } from "../../src/modules/clinic-patients/application/consents.js";
import { createCountActiveVisitsBySlotUseCase, createEnsureLinkedByEmailUseCase, createFindPatientIdsByMembersUseCase, createResolvePatientUseCase } from "../../src/modules/clinic-patients/application/directory.js";
import { createLinkClinicPatientUseCase } from "../../src/modules/clinic-patients/application/patient-link.js";
import { createCreateClinicPatientUseCase, createGetClinicPatientUseCase, createListClinicPatientsUseCase } from "../../src/modules/clinic-patients/application/patients.js";
import type { ClinicPatientsDeps, SlotFacts } from "../../src/modules/clinic-patients/application/ports.js";
import { createPurgeLinkCodesJobUseCase } from "../../src/modules/clinic-patients/application/purge-link-codes.js";
import { createGetSharedHistoryUseCase } from "../../src/modules/clinic-patients/application/shared-history.js";
import { createBookVisitUseCase, createCancelVisitUseCase, createCompleteVisitUseCase, createListVisitsUseCase } from "../../src/modules/clinic-patients/application/visits.js";
import { InMemoryRateLimiter } from "../../src/modules/clinic-patients/domain/rate-limiter.js";
import { KyselyConsentsRepository, KyselyLinkCodesRepository, KyselyLinksRepository, KyselyPatientsRepository, KyselyVisitsRepository } from "../../src/modules/clinic-patients/infrastructure/repo.js";
import { KyselyClinicSlotsRepository } from "../../src/modules/clinics/infrastructure/clinic-slots-repo.js";
import { KyselyClinicsRepository } from "../../src/modules/clinics/infrastructure/repo.js";
import type { ClinicSlot } from "../../src/modules/clinics/domain/clinic-slot.js";
import type { AuditEvent } from "../../src/modules/audit/index.js";

describe("integração: pacientes da clínica (migração 0028)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  const clock = new FixedClock(new Date());
  const slotsRepo = new KyselyClinicSlotsRepository();
  const clinicsRepo = new KyselyClinicsRepository();
  const appointmentsRepo = new KyselyAppointmentsRepository();
  const audit: AuditEvent[] = [];
  const ids = { clinic: randomUUID(), other: randomUUID(), account: randomUUID() };
  const actor = { clinicAccountId: ids.account, clinicId: ids.clinic };
  const ctx = { requestId: "req-int", ip: "10.0.0.1" };
  const FUTURE = new Date(Date.now() + 30 * 86_400_000);

  const toFacts = (s: ClinicSlot): SlotFacts => ({
    id: s.id, clinicId: s.clinicId, kind: s.kind, specialty: s.specialty, startsAt: s.startsAt, durationMinutes: s.durationMinutes, capacity: s.capacity,
    ...(s.professionalId ? { professionalId: s.professionalId } : {}),
    ...(s.professionalName ? { professionalName: s.professionalName } : {}),
  });

  const cpDeps = (): ClinicPatientsDeps<Kysely<Database>> => ({
    patientsRepo: new KyselyPatientsRepository(),
    linksRepo: new KyselyLinksRepository(),
    consentsRepo: new KyselyConsentsRepository(),
    codesRepo: new KyselyLinkCodesRepository(),
    visitsRepo: new KyselyVisitsRepository(),
    policy: {
      can: (_trx, input) => Promise.resolve({ actor: { id: input.subjectMemberId ?? "", familyId: input.familyId, name: "", isDependent: false, status: "ACTIVE" }, relation: "SELF" }),
    },
    members: {
      getMemberName: async (trx, familyId, memberId) => (await trx.selectFrom("family_members").select("name").where("family_id", "=", familyId).where("id", "=", memberId).executeTakeFirst())?.name ?? null,
    },
    clinics: {
      findPartnerClinic: async (trx, clinicId) => {
        const c = await clinicsRepo.findById(trx, clinicId);
        return c?.type === "PARTNER" ? { id: c.id, name: c.name, active: c.status === "ACTIVE" } : null;
      },
    },
    sharedHistory: {
      listActiveMedications: () => Promise.resolve([{ name: "Metformina", dosage: "500 mg", startAt: new Date(), endAt: null, continuous: true }]),
      listExams: () => Promise.resolve([]),
    },
    calendar: {
      listAppointments: () => Promise.resolve([]), listExaminations: () => Promise.resolve([]), listRecentAppointments: () => Promise.resolve([]),
      listRecentExaminations: () => Promise.resolve([]), listAppointmentsOfMember: () => Promise.resolve([]), listExaminationsOfMember: () => Promise.resolve([]),
    },
    recommendations: { listOfMember: () => Promise.resolve([]) },
    slots: {
      lockSlot: async (trx, id) => { const s = await slotsRepo.lockById(trx, id); return s ? toFacts(s) : null; },
      listSlots: async (trx, clinicId, w) => (await slotsRepo.listByClinic(trx, clinicId, { from: w.from, to: w.to })).map(toFacts),
      findSlotsByIds: async (trx, clinicId, slotIds) => (await slotsRepo.listByIds(trx, clinicId, slotIds)).map(toFacts),
      countActiveBySlot: (trx, slotIds) => appointmentsRepo.countActiveBySlot(trx, slotIds),
      listProfessionalSlotsOverlapping: async (trx, p, from, to, ex) => (await slotsRepo.listByProfessional(trx, p, { endsAfter: from, startsBefore: to })).filter((s) => s.id !== ex).map((s) => s.id),
      findProfessional: () => Promise.resolve(null),
    },
    searchLimiter: new InMemoryRateLimiter(clock),
    sharedLimiter: new InMemoryRateLimiter(clock),
    audit: { record: (_t, e) => Promise.resolve(void audit.push(e)) },
    linkCodeSecret: "integration-secret-0123456789",
    withTransaction: (fn) => withTransaction(db, fn),
    clock,
  });

  function apDeps(cp: ClinicPatientsDeps<Kysely<Database>>): AppointmentsDeps<Kysely<Database>> {
    const unused = (): never => { throw new Error("não usado"); };
    return {
      appointmentsRepo, policy: { can: unused }, membership: { getMembershipFacts: unused },
      memberNames: cp.members,
      clinics: {
        getBookableClinic: async (trx, _f, clinicId) => { const c = await clinicsRepo.findById(trx, clinicId); return c ? { id: c.id, name: c.name } : null; },
        listFreeSlots: unused,
        findSlot: async (clinicId, slotId) => { const s = await slotsRepo.findById(db, slotId); return s?.clinicId === clinicId ? s : null; },
        lockSlot: (trx, slotId) => slotsRepo.lockById(trx, slotId),
        listProfessionalSlotsOverlapping: () => Promise.resolve([]),
      },
      examSlotOccupancy: { countScheduledBySlot: () => Promise.resolve([]) },
      prescriptions: { issueForClinic: unused },
      patients: {
        findSelfByEmail: async (trx, email) => {
          const r = await trx.selectFrom("users").innerJoin("family_members", "family_members.user_id", "users.id").select(["users.name as name", "family_members.id as memberId", "family_members.family_id as familyId"]).where("users.email", "=", email).executeTakeFirst();
          return r ? { familyId: r.familyId, memberId: r.memberId, fullName: r.name } : null;
        },
      },
      clinicPatients: {
        resolvePatient: createResolvePatientUseCase(cp), ensureLinkedByEmail: createEnsureLinkedByEmailUseCase(cp), bookVisit: createBookVisitUseCase(cp),
        listVisits: createListVisitsUseCase(cp), cancelVisit: createCancelVisitUseCase(cp), completeVisit: createCompleteVisitUseCase(cp),
        countActiveVisitsBySlot: createCountActiveVisitsBySlotUseCase(cp), findPatientIdsByMembers: createFindPatientIdsByMembersUseCase(cp),
      },
      walkInRateLimiter: new WalkInInMemoryRateLimiter(clock),
      audit: cp.audit, db, withTransaction: cp.withTransaction, clock,
    };
  }

  async function newFamilyMember(name = "Maria Santos Silva", email = `${randomUUID()}@example.pt`) {
    const familyId = randomUUID(), userId = randomUUID(), memberId = randomUUID();
    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x',$3,'1990-01-01','Europe/Lisbon','ACTIVE','1',now())", [userId, email, name]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam')", [familyId]);
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,$4,'1990-01-01','FAMILY_ADMIN')", [memberId, familyId, userId, name]);
    return { familyId, userId, memberId, email };
  }

  async function newSlot(startsAt = FUTURE, clinicId = ids.clinic, professionalId?: string): Promise<string> {
    const id = randomUUID();
    await slotsRepo.insert(db, { id, clinicId, kind: "APPOINTMENT", specialty: "Cardiologia", startsAt, durationMinutes: 30, capacity: 1, createdAt: new Date(), ...(professionalId ? { professionalId } : {}) });
    return id;
  }

  async function count(table: string, where: string, params: unknown[]): Promise<number> {
    return ((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params)).rows[0] as { n: number }).n;
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
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica Sol'), ($2,'PARTNER','Outra')", [ids.clinic, ids.other]);
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'c@c.pt','x','CLINIC_ADMIN')", [ids.account, ids.clinic]);
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("0028 aplicada; CHECK do history_valid_until, UNIQUE de ligação e FK composta entre clínicas", async () => {
    expect((await pool.query("SELECT version FROM schema_migrations")).rows.map((r: { version: string }) => r.version)).toContain("0028_clinic_patients");
    const { familyId, memberId } = await newFamilyMember();
    await expect(pool.query("INSERT INTO clinic_consents (clinic_id, family_id, member_id, level) VALUES ($1,$2,$3,'HISTORY')", [ids.clinic, familyId, memberId])).rejects.toThrow(/history_valid_until_check/);
    await expect(pool.query("INSERT INTO clinic_consents (clinic_id, family_id, member_id, level, history_valid_until) VALUES ($1,$2,$3,'BOOKINGS', now())", [ids.clinic, familyId, memberId])).rejects.toThrow(/history_valid_until_check/);
    const create = createCreateClinicPatientUseCase(cpDeps());
    const a = await create(actor, { name: "A" }, ctx);
    const b = await create(actor, { name: "B" }, ctx);
    await pool.query("INSERT INTO clinic_patient_links (clinic_id, clinic_patient_id, family_id, member_id, via) VALUES ($1,$2,$3,$4,'CODE')", [ids.clinic, a.id, familyId, memberId]);
    await expect(pool.query("INSERT INTO clinic_patient_links (clinic_id, clinic_patient_id, family_id, member_id, via) VALUES ($1,$2,$3,$4,'CODE')", [ids.clinic, a.id, familyId, randomUUID()])).rejects.toThrow();
    await expect(pool.query("INSERT INTO clinic_patient_links (clinic_id, clinic_patient_id, family_id, member_id, via) VALUES ($1,$2,$3,$4,'CODE')", [ids.clinic, b.id, familyId, memberId])).rejects.toThrow(/clinic_member_key/);
    // paciente de uma clínica nunca se liga com o clinic_id de outra
    await expect(pool.query("INSERT INTO clinic_patient_links (clinic_id, clinic_patient_id, family_id, member_id, via) VALUES ($1,$2,$3,$4,'CODE')", [ids.other, b.id, familyId, (await newFamilyMember()).memberId])).rejects.toThrow(/patient_fk/);
  });

  it("pesquisa real: sem acentos/maiúsculas, e-mail, dígitos, % e _ literais, birth_date em texto, cursor estável", async () => {
    const deps = cpDeps();
    const create = createCreateClinicPatientUseCase(deps);
    const clinic = randomUUID();
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Pesquisa')", [clinic]);
    const a = { clinicAccountId: ids.account, clinicId: clinic };
    for (const p of [{ name: "Ângela Costa", phone: "+351 911 000 111", birthDate: "1985-03-04" }, { name: "Bruno_Dias", email: "bruno@clinica.pt" }, { name: "100% Natural" }, { name: "Zé" }]) await create(a, p, ctx);
    const list = createListClinicPatientsUseCase(deps);
    const names = async (q?: string) => (await list(a, { q })).items.map((p) => p.name);
    expect(await names("ANGELA")).toEqual(["Ângela Costa"]);
    expect(await names("clinica.pt")).toEqual(["Bruno_Dias"]);
    expect(await names("911 000")).toEqual(["Ângela Costa"]);
    expect(await names("0%")).toEqual(["100% Natural"]);
    expect(await names("o_")).toEqual(["Bruno_Dias"]);
    expect(await names("%%")).toEqual([]);
    expect((await list(a, {})).items.find((p) => p.name === "Ângela Costa")?.birthDate).toBe("1985-03-04");
    const p1 = await list(a, { limit: 3 });
    const p2 = await list(a, { limit: 3, cursor: (p1.nextCursor ?? "") });
    expect([...p1.items, ...p2.items].map((p) => p.name)).toEqual(["100% Natural", "Ângela Costa", "Bruno_Dias", "Zé"]);
    expect(p2.nextCursor).toBeNull();
    const search = await createClinicGlobalSearchUseCase(deps)(a, "bruno");
    expect(search.patients.map((p) => p.name)).toEqual(["Bruno_Dias"]);
    // isolamento
    expect((await list(actor, { q: "bruno" })).items).toEqual([]);
    await expect(createGetClinicPatientUseCase(deps)(actor, search.patients[0]?.id ?? "")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("código: HMAC em BD, uso único sob concorrência (1 só vence), expiração, conflito reverte o consumo, job de limpeza", async () => {
    const deps = cpDeps();
    const m = await newFamilyMember();
    const { code } = await createCreateClinicLinkCodeUseCase(deps)({ userId: m.userId, platformAdmin: false }, m.familyId, m.memberId, ctx);
    const stored = ((await pool.query("SELECT code_hash FROM clinic_link_codes WHERE member_id = $1", [m.memberId])).rows[0] as { code_hash: string }).code_hash;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.toUpperCase()).not.toContain(code);
    const link = createLinkClinicPatientUseCase(deps);
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => link(actor, { code }, { requestId: "r", ip: `10.2.0.${String(i)}` })));
    const ok = results.filter((r) => r.status === "fulfilled");
    expect(ok).toHaveLength(1);
    for (const r of results.filter((x): x is PromiseRejectedResult => x.status === "rejected")) expect(r.reason).toMatchObject({ code: "NOT_FOUND" });
    expect(await count("clinic_patient_links", "member_id = $1", [m.memberId])).toBe(1);
    expect(await count("clinic_consents", "member_id = $1 AND level = 'BOOKINGS'", [m.memberId])).toBe(1);

    // CONFLICT (membro já ligado a outro paciente) reverte o consumo: o código continua válido
    const other = await createCreateClinicPatientUseCase(deps)(actor, { name: "Outro" }, ctx);
    const second = await createCreateClinicLinkCodeUseCase(deps)({ userId: m.userId, platformAdmin: false }, m.familyId, m.memberId, ctx);
    await expect(link(actor, { code: second.code, clinicPatientId: other.id }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await count("clinic_link_codes", "member_id = $1 AND used_at IS NULL", [m.memberId])).toBe(1);

    // expiração (relógio injetado)
    const fresh = await createCreateClinicLinkCodeUseCase(deps)({ userId: m.userId, platformAdmin: false }, m.familyId, m.memberId, ctx);
    const later = cpDeps();
    const clk = new FixedClock(new Date(Date.now() + 11 * 60_000));
    await expect(createLinkClinicPatientUseCase({ ...later, clock: clk })(actor, { code: fresh.code }, { requestId: "r", ip: "10.3.0.1" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    // job: apaga expirados/usados há > 24 h
    await pool.query("UPDATE clinic_link_codes SET expires_at = now() - interval '30 hours' WHERE member_id = $1", [m.memberId]);
    const purge = createPurgeLinkCodesJobUseCase({ codesRepo: new KyselyLinkCodesRepository(), audit: deps.audit, withTransaction: deps.withTransaction, clock: new FixedClock(new Date()) });
    expect((await purge()).removed).toBeGreaterThanOrEqual(1);
    expect(await count("clinic_link_codes", "member_id = $1", [m.memberId])).toBe(0);
  });

  it("concorrência: visita manual × consulta Vita no mesmo horário => só uma vence; visita ocupa o horário", async () => {
    const deps = cpDeps();
    const m = await newFamilyMember();
    const patient = await createCreateClinicPatientUseCase(deps)(actor, { name: "Cliente" }, ctx);
    const slotId = await newSlot(new Date(FUTURE.getTime() + 86_400_000));
    const walkIn = createCreateWalkInAppointmentUseCase(apDeps(deps));
    const results = await Promise.allSettled([walkIn(actor, { patientEmail: m.email, slotId }, { requestId: "r", ip: "10.4.0.1" }), walkIn(actor, { clinicPatientId: patient.id, slotId }, { requestId: "r", ip: "10.4.0.2" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "CONFLICT" });
    expect((await count("appointments", "slot_id = $1", [slotId])) + (await count("clinic_visits", "slot_id = $1", [slotId]))).toBe(1);
    // índice único parcial: duas visitas SCHEDULED no mesmo horário são impossíveis mesmo sem passar pela aplicação
    const slot2 = await newSlot(new Date(FUTURE.getTime() + 2 * 86_400_000));
    const insert = () => pool.query("INSERT INTO clinic_visits (clinic_id, clinic_patient_id, slot_id, scheduled_at, duration_minutes) VALUES ($1,$2,$3,now(),30)", [ids.clinic, patient.id, slot2]);
    await insert();
    await expect(insert()).rejects.toThrow(/slot_active_idx/);
  });

  it("visita manual: reservar, cancelar liberta, completar; remover horário com visita ativa é bloqueado pela ocupação; sobreposição do paciente", async () => {
    const deps = cpDeps();
    const patient = await createCreateClinicPatientUseCase(deps)(actor, { name: "Visita" }, ctx);
    const start = new Date(FUTURE.getTime() + 5 * 86_400_000);
    const s1 = await newSlot(start);
    const s2 = await newSlot(new Date(start.getTime() + 10 * 60_000));
    const book = createBookVisitUseCase(deps);
    const view = await withTransaction(db, (trx) => book(trx, actor, { clinicPatientId: patient.id, slotId: s1, notes: "x" }, ctx));
    expect(view).toMatchObject({ source: "MANUAL", status: "SCHEDULED", slotId: s1 });
    await expect(withTransaction(db, (trx) => book(trx, actor, { clinicPatientId: patient.id, slotId: s2 }, ctx))).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await createCountActiveVisitsBySlotUseCase(deps)(db, [s1])).toEqual([{ slotId: s1, count: 1 }]);
    expect(await withTransaction(db, (trx) => createCancelVisitUseCase(deps)(trx, actor, view.id, "motivo", ctx))).toMatchObject({ status: "CANCELLED" });
    expect(await createCountActiveVisitsBySlotUseCase(deps)(db, [s1])).toEqual([]);
    const again = await withTransaction(db, (trx) => book(trx, actor, { clinicPatientId: patient.id, slotId: s1 }, ctx));
    expect(await withTransaction(db, (trx) => createCompleteVisitUseCase(deps)(trx, actor, again.id, { outcomeNote: "ok" }, ctx))).toMatchObject({ status: "COMPLETED" });
    expect(await withTransaction(db, (trx) => createCancelVisitUseCase(deps)(trx, { ...actor, clinicId: ids.other }, again.id, "x", ctx))).toBeNull();
  });

  it("consentimento: expiração com relógio injetado e apagamento do membro (BR-CLN-24): ligação/consentimento/códigos caem; o registo e as visitas ficam, sem ids Vita", async () => {
    const deps = cpDeps();
    const m = await newFamilyMember();
    await createPutClinicConsentUseCase(deps)({ userId: m.userId, platformAdmin: false }, m.familyId, m.memberId, ids.clinic, { level: "HISTORY" }, ctx);
    const { code } = await createCreateClinicLinkCodeUseCase(deps)({ userId: m.userId, platformAdmin: false }, m.familyId, m.memberId, ctx);
    const patient = await createLinkClinicPatientUseCase(deps)(actor, { code }, { requestId: "r", ip: "10.5.0.1" });
    expect(patient.vitaLink).toMatchObject({ via: "CODE", consentLevel: "HISTORY" });
    await createCreateClinicLinkCodeUseCase(deps)({ userId: m.userId, platformAdmin: false }, m.familyId, m.memberId, ctx);
    expect((await createGetSharedHistoryUseCase(deps)(actor, patient.id, ctx)).active).toBe(true);
    const future = { ...deps, clock: new FixedClock(new Date(Date.now() + 366 * 86_400_000)) };
    expect((await createGetSharedHistoryUseCase(future)(actor, patient.id, ctx)).active).toBe(false);

    const slotId = await newSlot(new Date(FUTURE.getTime() + 9 * 86_400_000));
    await withTransaction(db, (trx) => createBookVisitUseCase(deps)(trx, actor, { clinicPatientId: patient.id, slotId }, ctx));
    await pool.query("DELETE FROM family_members WHERE id = $1", [m.memberId]);
    expect(await count("clinic_patient_links", "member_id = $1", [m.memberId])).toBe(0);
    expect(await count("clinic_consents", "member_id = $1", [m.memberId])).toBe(0);
    expect(await count("clinic_link_codes", "member_id = $1", [m.memberId])).toBe(0);
    const after = await createGetClinicPatientUseCase(deps)(actor, patient.id);
    expect(after).toMatchObject({ id: patient.id, vitaLink: null });
    expect(JSON.stringify(after)).not.toContain(m.memberId);
    expect(await count("clinic_visits", "clinic_patient_id = $1", [patient.id])).toBe(1);
    expect((await createGetSharedHistoryUseCase(deps)(actor, patient.id, ctx)).active).toBe(false);
    // clinic_patients/clinic_visits não têm colunas com ids Vita
    const cols = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name IN ('clinic_patients','clinic_visits')")).rows.map((r: { column_name: string }) => r.column_name);
    expect(cols.filter((c) => /family|member|user/.test(c))).toEqual([]);
  });

  it("cascatas: apagar a conta (utilizador), a família e a clínica", async () => {
    const deps = cpDeps();
    const link = async (m: Awaited<ReturnType<typeof newFamilyMember>>, clinicId = ids.clinic) => {
      const p = await createCreateClinicPatientUseCase(deps)({ ...actor, clinicId }, { name: "P" }, ctx);
      await pool.query("INSERT INTO clinic_patient_links (clinic_id, clinic_patient_id, family_id, member_id, via) VALUES ($1,$2,$3,$4,'EMAIL')", [clinicId, p.id, m.familyId, m.memberId]);
      await pool.query("INSERT INTO clinic_consents (clinic_id, family_id, member_id, level) VALUES ($1,$2,$3,'BOOKINGS')", [clinicId, m.familyId, m.memberId]);
      await pool.query("INSERT INTO clinic_link_codes (family_id, member_id, code_hash, expires_at) VALUES ($1,$2,$3,now())", [m.familyId, m.memberId, randomUUID()]);
      return p;
    };
    const acc = await newFamilyMember();
    const p1 = await link(acc);
    await pool.query("DELETE FROM users WHERE id = $1", [acc.userId]);
    expect(await count("clinic_patient_links", "member_id = $1", [acc.memberId])).toBe(0);
    expect(await count("clinic_patients", "id = $1", [p1.id])).toBe(1);
    const fam = await newFamilyMember();
    const p2 = await link(fam);
    await pool.query("DELETE FROM families WHERE id = $1", [fam.familyId]);
    expect(await count("clinic_consents", "family_id = $1", [fam.familyId])).toBe(0);
    expect(await count("clinic_link_codes", "family_id = $1", [fam.familyId])).toBe(0);
    expect(await count("clinic_patients", "id = $1", [p2.id])).toBe(1);

    // apagar a clínica apaga as cinco tabelas (visitas com FK composta NO ACTION incluídas)
    const clinic = randomUUID();
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Efémera')", [clinic]);
    const m = await newFamilyMember();
    const p3 = await link(m, clinic);
    const slot = await newSlot(FUTURE, clinic);
    await pool.query("INSERT INTO clinic_visits (clinic_id, clinic_patient_id, slot_id, scheduled_at, duration_minutes) VALUES ($1,$2,$3,now(),30)", [clinic, p3.id, slot]);
    await pool.query("DELETE FROM clinics WHERE id = $1", [clinic]);
    for (const t of ["clinic_patients", "clinic_patient_links", "clinic_consents", "clinic_visits"]) expect(await count(t, "clinic_id = $1", [clinic])).toBe(0);
  });
});
