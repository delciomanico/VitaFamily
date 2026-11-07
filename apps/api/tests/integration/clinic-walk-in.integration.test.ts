// Integração real (testcontainers + PostgreSQL 16) da marcação presencial pela clínica (D20, ADR-024,
// BR-CLN-10, AC-CLN-06, TC-CLN-03): migração 0026 (colunas e CHECK), repositório Kysely e o caso de uso real
// sobre o repositório real (SELECT … FOR UPDATE: duas marcações simultâneas no mesmo horário => só uma vence).
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { SystemClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { createListClinicAgendaUseCase } from "../../src/modules/appointments/application/clinic-appointments.js";
import { createClinicPatientLookupUseCase, createCreateWalkInAppointmentUseCase } from "../../src/modules/appointments/application/clinic-walk-in.js";
import type { AppointmentsDeps } from "../../src/modules/appointments/application/ports.js";
import { WalkInInMemoryRateLimiter } from "../../src/modules/appointments/domain/walk-in.js";
import { KyselyAppointmentsRepository } from "../../src/modules/appointments/infrastructure/repo.js";
import { KyselyClinicSlotsRepository } from "../../src/modules/clinics/infrastructure/clinic-slots-repo.js";
import { KyselyClinicsRepository } from "../../src/modules/clinics/infrastructure/repo.js";
import type { AuditEvent } from "../../src/modules/audit/index.js";

describe("integração: marcação presencial (walk-in) — migração 0026 e repositórios", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  const appointments = new KyselyAppointmentsRepository();
  const slots = new KyselyClinicSlotsRepository();
  const clinicsRepo = new KyselyClinicsRepository();
  const audit: AuditEvent[] = [];
  const clock = new SystemClock();
  const ids = { clinic: randomUUID(), otherClinic: randomUUID(), account: randomUUID(), family: randomUUID() };
  const actor = { clinicAccountId: ids.account, clinicId: ids.clinic };
  const ctx = { requestId: "req-int", ip: "10.0.0.1" };
  const FUTURE = new Date(Date.now() + 30 * 24 * 3600 * 1000);

  /** Utilizador + membro SELF (estado variável) — `emailPrefix` é o e-mail exato da pesquisa. */
  async function newPatient(email: string, userStatus: "ACTIVE" | "SUSPENDED" | "PENDING_VERIFICATION" = "ACTIVE", withSelf = true, name = "Maria Santos Silva") {
    const userId = randomUUID();
    const memberId = randomUUID();
    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x',$3,'1990-01-01','Europe/Lisbon',$4,'1',now())", [userId, email, name, userStatus]);
    if (withSelf) {
      await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,$4,'1990-01-01','FAMILY_MEMBER')", [memberId, ids.family, userId, name]);
    }
    return { userId, memberId };
  }

  async function newSlot(kind: "APPOINTMENT" | "EXAM" = "APPOINTMENT", clinicId = ids.clinic, startsAt = FUTURE): Promise<string> {
    const id = randomUUID();
    await slots.insert(db, { id, clinicId, kind, specialty: "Cardiologia", startsAt, durationMinutes: 30, capacity: 1, createdAt: new Date() });
    return id;
  }

  function buildDeps(): AppointmentsDeps<Kysely<Database>> {
    const unused = (): never => {
      throw new Error("porta não usada neste teste");
    };
    return {
      appointmentsRepo: appointments,
      policy: { can: unused },
      membership: { getMembershipFacts: unused },
      memberNames: {
        getMemberName: async (trx, familyId, memberId) => {
          const row = await trx.selectFrom("family_members").select("name").where("family_id", "=", familyId).where("id", "=", memberId).executeTakeFirst();
          return row?.name ?? null;
        },
      },
      clinics: {
        getBookableClinic: async (trx, _familyId, clinicId) => {
          const clinic = await clinicsRepo.findById(trx, clinicId);
          return clinic ? { id: clinic.id, name: clinic.name } : null;
        },
        listFreeSlots: unused,
        findSlot: async (clinicId, slotId) => {
          const slot = await slots.findById(db, slotId);
          return slot?.clinicId === clinicId ? slot : null;
        },
        lockSlot: (trx, slotId) => slots.lockById(trx, slotId),
        listProfessionalSlotsOverlapping: async (trx, professionalId, from, to, excludeSlotId) =>
          (await slots.listByProfessional(trx, professionalId, { endsAfter: from, startsBefore: to })).filter((slot) => slot.id !== excludeSlotId).map((slot) => slot.id),
      },
      examSlotOccupancy: { countScheduledBySlot: unused },
      prescriptions: { issueForClinic: unused },
      // Mesma regra da raiz (main/api.ts): só utilizador ACTIVE com membro SELF.
      patients: {
        findSelfByEmail: async (trx, email) => {
          const row = await trx
            .selectFrom("users")
            .innerJoin("family_members", "family_members.user_id", "users.id")
            .select(["users.name as name", "family_members.id as memberId", "family_members.family_id as familyId"])
            .where("users.email", "=", email)
            .where("users.status", "=", "ACTIVE")
            .executeTakeFirst();
          return row ? { familyId: row.familyId, memberId: row.memberId, fullName: row.name } : null;
        },
      },
      walkInRateLimiter: new WalkInInMemoryRateLimiter(clock),
      audit: { record: (_trx, event) => Promise.resolve(void audit.push(event)) },
      db,
      withTransaction: (fn) => withTransaction(db, fn),
      clock,
    };
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
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam')", [ids.family]);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica Sol'), ($2,'PARTNER','Outra')", [ids.clinic, ids.otherClinic]);
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'c@c.pt','x','CLINIC_ADMIN')", [ids.account, ids.clinic]);
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("0026 aplicada; consultas existentes ficam walk_in=false; CHECK: autor só com walk_in", async () => {
    const applied = await pool.query("SELECT version FROM schema_migrations WHERE version >= '0026'");
    expect(applied.rows.map((r: { version: string }) => r.version)).toContain("0026_appointment_walk_in");
    const patient = await newPatient("legado@example.pt");
    const plain = await pool.query("INSERT INTO appointments (family_id, member_id, scheduled_at) VALUES ($1,$2,now()) RETURNING walk_in, booked_by_clinic_account_id", [ids.family, patient.memberId]);
    expect(plain.rows[0]).toEqual({ walk_in: false, booked_by_clinic_account_id: null });
    await expect(pool.query("INSERT INTO appointments (family_id, member_id, scheduled_at, booked_by_clinic_account_id) VALUES ($1,$2,now(),$3)", [ids.family, patient.memberId, ids.account])).rejects.toThrow(/booked_by_clinic_requires_walk_in/);
  });

  it("lookup: ACTIVE com SELF => displayName; inexistente/suspenso/pendente/sem SELF => 404 indistinguível", async () => {
    await newPatient("ativo@example.pt");
    await newPatient("suspenso@example.pt", "SUSPENDED");
    await newPatient("pendente@example.pt", "PENDING_VERIFICATION");
    await newPatient("semself@example.pt", "ACTIVE", false);
    const lookup = createClinicPatientLookupUseCase(buildDeps());
    await expect(lookup(actor, { email: " ATIVO@Example.pt " }, ctx)).resolves.toEqual({ displayName: "Maria S." });
    const misses = [];
    for (const email of ["inexistente@example.pt", "suspenso@example.pt", "pendente@example.pt", "semself@example.pt", "ativ@example.pt"]) {
      misses.push(await lookup(actor, { email }, { ...ctx, ip: `10.9.0.${String(misses.length + 1)}` }).catch((e: unknown) => ({ code: (e as { code: string }).code, detail: (e as { detail: string }).detail })));
    }
    expect(new Set(misses.map((m) => JSON.stringify(m))).size).toBe(1);
    expect(misses[0]).toEqual({ code: "NOT_FOUND", detail: "Utilizador não encontrado." });
  });

  it("marca no SELF: SCHEDULED, walk_in, autor, slot_id; visível na agenda da clínica e na lista do paciente", async () => {
    const email = "marcar@example.pt";
    const patient = await newPatient(email);
    const slotId = await newSlot();
    const book = createCreateWalkInAppointmentUseCase(buildDeps());
    const view = await book(actor, { patientEmail: email, slotId, notes: "obs" }, ctx);
    expect(view).toMatchObject({ status: "SCHEDULED", patientName: "Maria Santos Silva", notes: "obs" });

    const row = await pool.query("SELECT family_id, member_id, status, walk_in, booked_by_clinic_account_id, slot_id, clinic_id FROM appointments WHERE id = $1", [view.id]);
    expect(row.rows[0]).toEqual({ family_id: ids.family, member_id: patient.memberId, status: "SCHEDULED", walk_in: true, booked_by_clinic_account_id: ids.account, slot_id: slotId, clinic_id: ids.clinic });
    expect((await createListClinicAgendaUseCase(buildDeps())(actor, {})).map((a) => a.id)).toContain(view.id);
    expect((await appointments.listByMember(db, ids.family, patient.memberId, {}, 10)).items.map((a) => a.id)).toEqual([view.id]);
    expect(audit.at(-1)).toMatchObject({ action: "CLINIC_WALKIN_BOOK", subjectMemberId: patient.memberId, metadata: { slotId } });
    expect(JSON.stringify(audit)).not.toContain(email);

    // Cancelar liberta o horário (BR-APT-06) e nova marcação é possível.
    await appointments.updateStatusByClinic(db, view.id, { status: "CANCELLED", responseNote: "x" });
    await expect(book(actor, { patientEmail: email, slotId }, ctx)).resolves.toMatchObject({ status: "SCHEDULED" });
  });

  it("remover a conta da clínica anula o autor mas mantém walk_in (SET NULL; CHECK não bloqueia)", async () => {
    const account = randomUUID();
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'tmp@c.pt','x','CLINIC_MANAGER')", [account, ids.clinic]);
    const patient = await newPatient("setnull@example.pt");
    const id = randomUUID();
    await appointments.insert(db, { id, familyId: ids.family, memberId: patient.memberId, scheduledAt: FUTURE, status: "SCHEDULED", clinicId: ids.clinic, clinicName: "Clínica Sol", slotId: await newSlot(), walkIn: true, bookedByClinicAccountId: account, createdAt: new Date() });
    await pool.query("DELETE FROM clinic_accounts WHERE id = $1", [account]);
    const after = await pool.query("SELECT walk_in, booked_by_clinic_account_id FROM appointments WHERE id = $1", [id]);
    expect(after.rows[0]).toEqual({ walk_in: true, booked_by_clinic_account_id: null });
  });

  it("slot de outra clínica => NOT_FOUND; EXAM => VALIDATION_ERROR; passado => CONFLICT; sobreposição => CONFLICT", async () => {
    const email = "regras@example.pt";
    const patient = await newPatient(email);
    const book = createCreateWalkInAppointmentUseCase(buildDeps());
    await expect(book(actor, { patientEmail: email, slotId: await newSlot("APPOINTMENT", ids.otherClinic) }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(book(actor, { patientEmail: email, slotId: await newSlot("EXAM") }, ctx)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(book(actor, { patientEmail: email, slotId: await newSlot("APPOINTMENT", ids.clinic, new Date("2020-01-01T10:00:00Z")) }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });

    const start = new Date(FUTURE.getTime() + 3 * 24 * 3600 * 1000);
    await appointments.insert(db, { id: randomUUID(), familyId: ids.family, memberId: patient.memberId, scheduledAt: new Date(start.getTime() + 5 * 60_000), status: "SCHEDULED", createdAt: new Date() });
    await expect(book(actor, { patientEmail: email, slotId: await newSlot("APPOINTMENT", ids.clinic, start) }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("concorrência: dois pacientes no mesmo horário => exatamente uma marcação vence", async () => {
    await newPatient("corrida1@example.pt");
    await newPatient("corrida2@example.pt");
    const slotId = await newSlot();
    const book = createCreateWalkInAppointmentUseCase(buildDeps());
    const results = await Promise.allSettled([
      book(actor, { patientEmail: "corrida1@example.pt", slotId }, ctx),
      book(actor, { patientEmail: "corrida2@example.pt", slotId }, ctx),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "CONFLICT" });
    const active = await pool.query("SELECT count(*)::int AS n FROM appointments WHERE slot_id = $1 AND status IN ('REQUESTED','SCHEDULED')", [slotId]);
    expect(active.rows[0]).toEqual({ n: 1 });
  });
});
