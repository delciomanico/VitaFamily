// Integração real (testcontainers + PostgreSQL 16) do M14 a1/a2 (ADR-026, TC-CLN-04/05/06/07, AC-CLN-07..12):
// migração 0027 sobre dados existentes, EXCLUDE/CHECK/FKs, cascata da clínica, repositórios Kysely, geração
// idempotente (job + regenerar), concorrência (serializada pelo bloqueio do profissional e dos horários),
// bloqueio com horários marcados e walk-in com sobreposição por duração.
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { SystemClock } from "../../src/platform/clock/index.js";
import { createDb, withTransaction, type Database } from "../../src/platform/db/index.js";
import { createAuditModule, type AuditEvent } from "../../src/modules/audit/index.js";
import { createCreateWalkInAppointmentUseCase } from "../../src/modules/appointments/application/clinic-walk-in.js";
import type { AppointmentsDeps } from "../../src/modules/appointments/application/ports.js";
import { WalkInInMemoryRateLimiter } from "../../src/modules/appointments/domain/walk-in.js";
import { KyselyAppointmentsRepository } from "../../src/modules/appointments/infrastructure/repo.js";
import { createCreateClinicProfessionalUseCase, createCreateClinicServiceTypeUseCase, createUpdateClinicProfessionalUseCase } from "../../src/modules/clinics/application/clinic-catalog.js";
import { createCreateClinicScheduleRuleUseCase, createRegenerateClinicScheduleRuleUseCase, createUpdateClinicScheduleRuleUseCase } from "../../src/modules/clinics/application/clinic-schedule-rules.js";
import { createPublishClinicSlotsUseCase, createRemoveClinicSlotUseCase } from "../../src/modules/clinics/application/clinic-slots.js";
import { createCreateClinicTimeOffUseCase, createDeleteClinicTimeOffUseCase, createListClinicTimeOffUseCase } from "../../src/modules/clinics/application/clinic-time-off.js";
import type { ClinicsDeps } from "../../src/modules/clinics/application/ports.js";
import { createGenerateScheduleJobUseCase } from "../../src/modules/clinics/application/schedule-generation.js";
import { KyselyClinicCatalogRepository, KyselyClinicScheduleRulesRepository, KyselyClinicTimeOffRepository } from "../../src/modules/clinics/infrastructure/clinic-catalog-repo.js";
import { KyselyClinicSlotsRepository } from "../../src/modules/clinics/infrastructure/clinic-slots-repo.js";
import { KyselyClinicsRepository } from "../../src/modules/clinics/infrastructure/repo.js";

function must<T>(value: T | undefined, what = "valor"): T {
  if (value === undefined) {
    throw new Error(`esperava ${what}`);
  }
  return value;
}

describe("integração: catálogo, regras, bloqueios e duração (migração 0027)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  const clock = new SystemClock();
  const slotsRepo = new KyselyClinicSlotsRepository();
  const appointmentsRepo = new KyselyAppointmentsRepository();
  const clinicsRepo = new KyselyClinicsRepository();
  const catalogRepo = new KyselyClinicCatalogRepository();
  const rulesRepo = new KyselyClinicScheduleRulesRepository();
  const timeOffRepo = new KyselyClinicTimeOffRepository();
  const events: AuditEvent[] = [];
  const ids = { clinicA: randomUUID(), clinicB: randomUUID(), accountA: randomUUID(), accountB: randomUUID(), family: randomUUID(), member: randomUUID() };
  const actorA = { clinicAccountId: ids.accountA, clinicId: ids.clinicA, role: "CLINIC_ADMIN" as const };
  const actorB = { clinicAccountId: ids.accountB, clinicId: ids.clinicB, role: "CLINIC_ADMIN" as const };
  const ctx = { requestId: "req-int", ip: "10.0.0.1" };
  const DAY = 24 * 3600 * 1000;
  /** Dia UTC daqui a `n` dias às 00:00Z (os horários locais 09:00–11:00 de Lisboa caem sempre dentro). */
  const utcDay = (n: number) => {
    const d = new Date(clock.now().getTime() + n * DAY);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  };
  const isoDate = (d: Date) => d.toISOString().slice(0, 10);

  function buildDeps(): ClinicsDeps<Kysely<Database>> {
    const audit = createAuditModule({ db });
    return {
      clinicsRepo,
      audit: {
        record: async (trx: Kysely<Database>, event: AuditEvent) => {
          events.push(event);
          await audit.record(trx, event);
        },
      },
      db,
      withTransaction: <T>(fn: (trx: Kysely<Database>) => Promise<T>) => withTransaction(db, fn),
      clock,
      clinicSlotsRepo: slotsRepo,
      // Mesma ligação da raiz (main/api.ts), só com consultas: não há exames nestes testes.
      slotOccupancy: { countActiveBySlot: (trx: Kysely<Database>, slotIds: string[]) => appointmentsRepo.countActiveBySlot(trx, slotIds) },
      catalogRepo,
      scheduleRulesRepo: rulesRepo,
      timeOffRepo,
      logger: { warn: () => undefined },
    } as unknown as ClinicsDeps<Kysely<Database>>;
  }

  const uc = () => {
    const deps = buildDeps();
    return {
      deps,
      createProfessional: createCreateClinicProfessionalUseCase(deps),
      updateProfessional: createUpdateClinicProfessionalUseCase(deps),
      createService: createCreateClinicServiceTypeUseCase(deps),
      createRule: createCreateClinicScheduleRuleUseCase(deps),
      updateRule: createUpdateClinicScheduleRuleUseCase(deps),
      regenerate: createRegenerateClinicScheduleRuleUseCase(deps),
      publish: createPublishClinicSlotsUseCase(deps),
      removeSlot: createRemoveClinicSlotUseCase(deps),
      createTimeOff: createCreateClinicTimeOffUseCase(deps),
      deleteTimeOff: createDeleteClinicTimeOffUseCase(deps),
      listTimeOff: createListClinicTimeOffUseCase(deps),
      job: createGenerateScheduleJobUseCase(deps),
    };
  };

  async function newCatalog(clinic = actorA, durationMinutes = 30, kind: "APPOINTMENT" | "EXAM" = "APPOINTMENT") {
    const u = uc();
    const professional = await u.createProfessional(clinic, { name: `Prof ${randomUUID().slice(0, 8)}` }, ctx);
    const service = await u.createService(clinic, { name: `Serv ${randomUUID().slice(0, 8)}`, kind, durationMinutes }, ctx);
    return { u, professional, service };
  }

  const allDays = [1, 2, 3, 4, 5, 6, 7];
  const slotRows = async (professionalId: string) => (await pool.query("SELECT id, starts_at, ends_at, schedule_rule_id FROM clinic_slots WHERE professional_id = $1 ORDER BY starts_at", [professionalId])).rows as { id: string; starts_at: Date; ends_at: Date; schedule_rule_id: string | null }[];

  async function book(slotId: string, status: "SCHEDULED" | "REQUESTED" = "SCHEDULED") {
    const slot = await slotsRepo.findById(db, slotId);
    if (!slot) throw new Error("horário inexistente");
    await appointmentsRepo.insert(db, { id: randomUUID(), familyId: ids.family, memberId: ids.member, scheduledAt: slot.startsAt, status, clinicId: slot.clinicId, clinicName: "Clínica A", slotId, durationMinutes: slot.durationMinutes, createdAt: new Date() });
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
    await pool.query("INSERT INTO family_members (id, family_id, name, birth_date) VALUES ($1,$2,'Paciente','1990-01-01')", [ids.member, ids.family]);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica A'), ($2,'PARTNER','Clínica B')", [ids.clinicA, ids.clinicB]);
    await pool.query("INSERT INTO clinic_accounts (id, clinic_id, email, password_hash, role) VALUES ($1,$2,'a@c.pt','x','CLINIC_ADMIN'), ($3,$4,'b@c.pt','x','CLINIC_ADMIN')", [ids.accountA, ids.clinicA, ids.accountB, ids.clinicB]);
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  describe("migração 0027 sobre dados existentes", () => {
    it("preserva horários/consultas: ends_at = início + duração; duration_minutes = 30 ou a do horário; clínicas ficam com AOA", async () => {
      const dir = await mkdtemp(join(tmpdir(), "vita-mig27-"));
      for (const file of (await readdir(defaultMigrationsDir())).filter((f) => f.endsWith(".sql") && f < "0027")) {
        await copyFile(join(defaultMigrationsDir(), file), join(dir, file));
      }
      await pool.query("CREATE DATABASE legacy27");
      const legacy = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/legacy27` });
      try {
        await runMigrations(legacy, dir);
        const [c, f, m, slot45, slotPlain] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        const startsAt = new Date(Date.now() + 10 * DAY);
        await legacy.query("INSERT INTO families (id, name) VALUES ($1,'F')", [f]);
        await legacy.query("INSERT INTO family_members (id, family_id, name, birth_date) VALUES ($1,$2,'P','1990-01-01')", [m, f]);
        await legacy.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','C')", [c]);
        await legacy.query("INSERT INTO clinic_slots (id, clinic_id, specialty, starts_at, duration_minutes) VALUES ($1,$2,'Geral',$3,45), ($4,$2,'Geral',$5,15)", [slot45, c, startsAt, slotPlain, new Date(startsAt.getTime() + DAY)]);
        const withSlot = randomUUID();
        const withoutSlot = randomUUID();
        await legacy.query("INSERT INTO appointments (id, family_id, member_id, scheduled_at, status, clinic_id, clinic_name, slot_id) VALUES ($1,$2,$3,$4,'REQUESTED',$5,'C',$6)", [withSlot, f, m, startsAt, c, slot45]);
        await legacy.query("INSERT INTO appointments (id, family_id, member_id, scheduled_at) VALUES ($1,$2,$3,$4)", [withoutSlot, f, m, startsAt]);

        await runMigrations(legacy, defaultMigrationsDir());

        const slots = await legacy.query("SELECT id, ends_at - starts_at AS len, professional_id, schedule_rule_id FROM clinic_slots ORDER BY duration_minutes");
        expect(slots.rows.map((r: { len: { minutes?: number; hours?: number } }) => (r.len.hours ?? 0) * 60 + (r.len.minutes ?? 0))).toEqual([15, 45]);
        expect(slots.rows.every((r: { professional_id: string | null; schedule_rule_id: string | null }) => r.professional_id === null && r.schedule_rule_id === null)).toBe(true);
        const durations = await legacy.query("SELECT id, duration_minutes FROM appointments");
        const byId = new Map(durations.rows.map((r: { id: string; duration_minutes: number }) => [r.id, r.duration_minutes]));
        expect(byId.get(withSlot)).toBe(45);
        expect(byId.get(withoutSlot)).toBe(30);
        expect((await legacy.query("SELECT currency FROM clinics WHERE id = $1", [c])).rows[0]).toEqual({ currency: "AOA" });
        // A moeda só aceita ISO 4217 em maiúsculas.
        await expect(legacy.query("UPDATE clinics SET currency = 'aoa' WHERE id = $1", [c])).rejects.toThrow(/currency/);
      } finally {
        await legacy.end();
      }
    });
  });

  describe("restrições da BD (schema.md §3a)", () => {
    async function rawProfessional(clinic = ids.clinicA): Promise<string> {
      const id = randomUUID();
      await pool.query("INSERT INTO clinic_professionals (id, clinic_id, name) VALUES ($1,$2,$3)", [id, clinic, `raw ${id}`]);
      return id;
    }
    const insertSlot = (clinic: string, professional: string | null, start: Date, minutes: number) =>
      pool.query("INSERT INTO clinic_slots (clinic_id, specialty, starts_at, duration_minutes, ends_at, professional_id) VALUES ($1,'Geral',$2,$3::int,$2::timestamptz + $3::int * interval '1 minute',$4)", [clinic, start, minutes, professional]);
    const T = (offsetMin: number) => new Date(Date.UTC(2031, 0, 6, 9, 0) + offsetMin * 60_000);

    it("EXCLUDE: rejeita sobreposição do mesmo profissional; aceita consecutivos, outro profissional e sem profissional", async () => {
      const p = await rawProfessional();
      const q = await rawProfessional();
      await insertSlot(ids.clinicA, p, T(0), 30);
      await expect(insertSlot(ids.clinicA, p, T(15), 30)).rejects.toMatchObject({ code: "23P01" });
      await expect(insertSlot(ids.clinicA, p, T(0), 15)).rejects.toMatchObject({ code: "23P01" });
      await expect(insertSlot(ids.clinicA, p, T(-15), 60)).rejects.toMatchObject({ code: "23P01" });
      await expect(insertSlot(ids.clinicA, p, T(30), 30)).resolves.toBeDefined(); // fim = início
      await expect(insertSlot(ids.clinicA, p, T(-30), 30)).resolves.toBeDefined();
      await expect(insertSlot(ids.clinicA, q, T(15), 30)).resolves.toBeDefined();
      await expect(insertSlot(ids.clinicA, null, T(0), 30)).resolves.toBeDefined(); // legados sem profissional
      await expect(insertSlot(ids.clinicA, null, T(0), 30)).resolves.toBeDefined();
    });

    it("CHECKs: ends_at coerente, regra exige catálogo; FKs compostas impedem ligar a outra clínica", async () => {
      await expect(pool.query("INSERT INTO clinic_slots (clinic_id, specialty, starts_at, duration_minutes, ends_at) VALUES ($1,'x',$2,30,$2::timestamptz + interval '10 minutes')", [ids.clinicA, T(600)])).rejects.toThrow(/ends_at_check/);
      const foreign = await rawProfessional(ids.clinicB);
      await expect(insertSlot(ids.clinicA, foreign, T(700), 30)).rejects.toMatchObject({ code: "23503" });
      const rule = randomUUID();
      await expect(pool.query("INSERT INTO clinic_slots (clinic_id, specialty, starts_at, duration_minutes, ends_at, schedule_rule_id) VALUES ($1,'x',$2,30,$2::timestamptz + interval '30 minutes',$3)", [ids.clinicA, T(800), rule])).rejects.toThrow();
    });

    it("CHECKs do catálogo/regras/bloqueios e UNIQUE parciais por nome ativo", async () => {
      await pool.query("INSERT INTO clinic_service_types (clinic_id, name, kind, duration_minutes, price_minor) VALUES ($1,'Dup','APPOINTMENT',30,0)", [ids.clinicA]);
      await expect(pool.query("INSERT INTO clinic_service_types (clinic_id, name, kind, duration_minutes) VALUES ($1,'dup','APPOINTMENT',30)", [ids.clinicA])).rejects.toMatchObject({ code: "23505" });
      await pool.query("INSERT INTO clinic_service_types (clinic_id, name, kind, duration_minutes) VALUES ($1,'dup','EXAM',30)", [ids.clinicA]);
      await expect(pool.query("INSERT INTO clinic_service_types (clinic_id, name, kind, duration_minutes) VALUES ($1,'x','EXAM',25)", [ids.clinicA])).rejects.toThrow(/duration/);
      await expect(pool.query("INSERT INTO clinic_service_types (clinic_id, name, kind, duration_minutes, price_minor) VALUES ($1,'neg','EXAM',30,-1)", [ids.clinicA])).rejects.toThrow(/price/);
      await expect(pool.query("INSERT INTO clinic_professionals (clinic_id, name) VALUES ($1,'')", [ids.clinicA])).rejects.toThrow(/name_length/);
      const p = await rawProfessional();
      await expect(pool.query("INSERT INTO clinic_time_off (clinic_id, professional_id, starts_at, ends_at) VALUES ($1,$2,$3,$3)", [ids.clinicA, p, T(0)])).rejects.toThrow(/range_check/);
      await expect(pool.query("INSERT INTO clinic_time_off (clinic_id, professional_id, starts_at, ends_at) VALUES ($1,$2,$3,$4)", [ids.clinicA, p, T(0), new Date(T(0).getTime() + 367 * DAY)])).rejects.toThrow(/range_check/);
      const svc = (await pool.query("SELECT id FROM clinic_service_types WHERE clinic_id = $1 LIMIT 1", [ids.clinicA])).rows[0] as { id: string };
      await expect(pool.query("INSERT INTO clinic_schedule_rules (clinic_id, professional_id, service_type_id, weekdays, start_time, end_time) VALUES ($1,$2,$3,'{1,1,9}','09:00','10:00')", [ids.clinicA, p, svc.id])).rejects.toThrow(/weekdays/);
      await expect(pool.query("INSERT INTO clinic_schedule_rules (clinic_id, professional_id, service_type_id, weekdays, start_time, end_time) VALUES ($1,$2,$3,'{1}','10:00','10:00')", [ids.clinicA, p, svc.id])).rejects.toThrow(/time_order/);
    });

    it("apagar uma clínica apaga as quatro tabelas novas e os horários sem violar as FKs NO ACTION", async () => {
      const clinic = randomUUID();
      await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Efémera')", [clinic]);
      const p = await rawProfessional(clinic);
      const s = randomUUID();
      await pool.query("INSERT INTO clinic_service_types (id, clinic_id, name, kind, duration_minutes) VALUES ($1,$2,'S','APPOINTMENT',30)", [s, clinic]);
      const r = randomUUID();
      await pool.query("INSERT INTO clinic_schedule_rules (id, clinic_id, professional_id, service_type_id, weekdays, start_time, end_time) VALUES ($1,$2,$3,$4,'{1}','09:00','10:00')", [r, clinic, p, s]);
      await pool.query("INSERT INTO clinic_slots (clinic_id, specialty, starts_at, duration_minutes, ends_at, professional_id, service_type_id, schedule_rule_id) VALUES ($1,'S',$2,30,$2::timestamptz + interval '30 minutes',$3,$4,$5)", [clinic, T(0), p, s, r]);
      await pool.query("INSERT INTO clinic_time_off (clinic_id, professional_id, starts_at, ends_at) VALUES ($1,$2,$3,$4)", [clinic, p, T(0), T(60)]);
      await pool.query("DELETE FROM clinics WHERE id = $1", [clinic]);
      for (const table of ["clinic_professionals", "clinic_service_types", "clinic_schedule_rules", "clinic_time_off", "clinic_slots"]) {
        expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE clinic_id = $1`, [clinic])).rows[0]).toEqual({ n: 0 });
      }
    });
  });

  describe("geração por regra sobre a BD real", () => {
    it("criar regra: 4 horários por dia nos dias previstos; regenerar e o job são idempotentes (created = 0, sem duplicados)", async () => {
      const { u, professional, service } = await newCatalog();
      const created = await u.createRule(actorA, { professionalId: professional.id, serviceTypeId: service.id, weekdays: allDays, startTime: "09:00", endTime: "11:00" }, ctx);
      const total = (await slotRows(professional.id)).length;
      expect(created.generation.created).toBe(total);
      expect(total).toBeGreaterThanOrEqual(4 * 56); // 8 semanas, todos os dias, menos o início de hoje que já passou

      const before = await slotRows(professional.id);
      expect((await u.regenerate(actorA, created.rule.id, ctx)).generation).toMatchObject({ created: 0, unchanged: total, removed: 0 });
      expect(await u.job()).toMatchObject({ failedRules: 0 });
      const jobAgain = await u.job();
      expect(jobAgain.created).toBe(0);
      const after = await slotRows(professional.id);
      expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
      // Consecutivos, sem sobreposição e ends_at = início + 30 min.
      expect(after.every((r) => r.ends_at.getTime() - r.starts_at.getTime() === 30 * 60_000 && r.schedule_rule_id === created.rule.id)).toBe(true);
      // Auditoria SYSTEM real em audit_logs, só contagens, sem actor de clínica.
      const row = (await pool.query("SELECT actor_type, actor_clinic_account_id, resource_id, metadata FROM audit_logs WHERE action = 'CLINIC_SCHEDULE_GENERATE' ORDER BY id DESC LIMIT 1")).rows[0] as { actor_type: string; actor_clinic_account_id: string | null; resource_id: string | null; metadata: Record<string, number> };
      expect(row).toMatchObject({ actor_type: "SYSTEM", actor_clinic_account_id: null, resource_id: null });
      expect(row.metadata).toMatchObject({ failedRules: 0, created: 0 });
    });

    it("horas locais em DST: 09:00 Lisboa = 08:00Z no verão e 09:00Z no inverno", async () => {
      const { u, professional, service } = await newCatalog(actorA, 30);
      await u.createRule(actorA, { professionalId: professional.id, serviceTypeId: service.id, weekdays: allDays, startTime: "09:00", endTime: "09:30" }, ctx);
      const hours = (await slotRows(professional.id)).map((r) => ({ month: r.starts_at.getUTCMonth() + 1, hour: r.starts_at.getUTCHours() }));
      for (const { month, hour } of hours) {
        if (month >= 4 && month <= 9) expect(hour).toBe(8);
        if (month === 12 || month <= 2) expect(hour).toBe(9);
      }
    });

    it("concorrência: duas gerações em paralelo (regenerar x2 + job) não duplicam nem falham", async () => {
      const { u, professional, service } = await newCatalog();
      const { rule } = await u.createRule(actorA, { professionalId: professional.id, serviceTypeId: service.id, weekdays: [1, 3, 5], startTime: "14:00", endTime: "16:00" }, ctx);
      const before = (await slotRows(professional.id)).length;
      const results = await Promise.all([u.regenerate(actorA, rule.id, ctx), u.regenerate(actorA, rule.id, ctx), uc().job()]);
      expect(results[0].generation.created + results[1].generation.created).toBe(0);
      expect((await slotRows(professional.id)).length).toBe(before);
    });

    it("concorrência: dois POST /slots sobrepostos em paralelo para o mesmo profissional => só um vence; o outro CONFLICT", async () => {
      const { u, professional, service } = await newCatalog();
      const date = isoDate(utcDay(20));
      const settled = await Promise.allSettled([
        u.publish(actorA, { date, times: ["09:00"], professionalId: professional.id, serviceTypeId: service.id }, ctx),
        u.publish(actorA, { date, times: ["09:15"], professionalId: professional.id, serviceTypeId: service.id }, ctx),
      ]);
      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
      const rejected = must<PromiseRejectedResult>(settled.find((s): s is PromiseRejectedResult => s.status === "rejected"));
      expect(rejected.reason).toMatchObject({ code: "CONFLICT" });
      expect((await slotRows(professional.id)).length).toBe(1);
    });

    it("lote com sobreposição interna não cria nada (transação desfeita)", async () => {
      const { u, professional, service } = await newCatalog();
      const date = isoDate(utcDay(21));
      await u.publish(actorA, { date, times: ["15:00"], professionalId: professional.id, serviceTypeId: service.id }, ctx);
      await expect(u.publish(actorA, { date, times: ["10:00", "15:15"], professionalId: professional.id, serviceTypeId: service.id }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });
      expect((await slotRows(professional.id)).length).toBe(1);
    });

    it("concorrência: nome duplicado entre ativos (2 pedidos em paralelo) => um 201, um CONFLICT (UNIQUE parcial)", async () => {
      const u = uc();
      const name = `Concorrente ${randomUUID().slice(0, 6)}`;
      const settled = await Promise.allSettled([u.createProfessional(actorA, { name }, ctx), u.createProfessional(actorA, { name: name.toUpperCase() }, ctx)]);
      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
      expect((must<PromiseRejectedResult>(settled.find((s): s is PromiseRejectedResult => s.status === "rejected"))).reason).toMatchObject({ code: "CONFLICT" });
    });

    it("concorrência: duas regras sobrepostas em paralelo para o mesmo profissional => só uma é criada", async () => {
      const { u, professional, service } = await newCatalog();
      const body = { professionalId: professional.id, serviceTypeId: service.id, weekdays: [2], startTime: "09:00", endTime: "10:00" };
      const settled = await Promise.allSettled([u.createRule(actorA, body, ctx), u.createRule(actorA, { ...body, startTime: "09:30", endTime: "10:30" }, ctx)]);
      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
      expect((must<PromiseRejectedResult>(settled.find((s): s is PromiseRejectedResult => s.status === "rejected"))).reason).toMatchObject({ code: "CONFLICT" });
    });

    it("isolamento: outra clínica não alcança o profissional, o serviço, a regra nem o bloqueio (NOT_FOUND)", async () => {
      const { u, professional, service } = await newCatalog();
      const { rule } = await u.createRule(actorA, { professionalId: professional.id, serviceTypeId: service.id, weekdays: [3], startTime: "09:00", endTime: "10:00" }, ctx);
      const other = uc();
      await expect(other.createRule(actorB, { professionalId: professional.id, serviceTypeId: service.id, weekdays: [3], startTime: "09:00", endTime: "10:00" }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(other.regenerate(actorB, rule.id, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(other.updateProfessional(actorB, professional.id, { active: false }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(other.createTimeOff(actorB, { professionalId: professional.id, startsAt: utcDay(5).toISOString(), endsAt: utcDay(6).toISOString() }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(other.publish(actorB, { date: isoDate(utcDay(5)), times: ["09:00"], professionalId: professional.id, specialty: "x", durationMinutes: 30 }, ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("bloqueios com horários marcados (BR-CLN-14/15, AC-CLN-10/11)", () => {
    it("remove só os livres, mantém os marcados e as marcações; geração ignora o intervalo; remover o bloqueio repõe sem duplicar", async () => {
      const { u, professional, service } = await newCatalog();
      const { rule } = await u.createRule(actorA, { professionalId: professional.id, serviceTypeId: service.id, weekdays: allDays, startTime: "09:00", endTime: "11:00" }, ctx);
      const dayStart = utcDay(7);
      const dayEnd = utcDay(8);
      const inDay = (await slotRows(professional.id)).filter((r) => r.starts_at >= dayStart && r.starts_at < dayEnd);
      expect(inDay).toHaveLength(4);
      await book(inDay[0]?.id ?? "");
      await book(inDay[3]?.id ?? "", "REQUESTED");
      const totalBefore = (await slotRows(professional.id)).length;

      const result = await u.createTimeOff(actorA, { professionalId: professional.id, startsAt: dayStart.toISOString(), endsAt: dayEnd.toISOString(), reason: "Férias privadas" }, ctx);

      expect(result.removedSlots).toBe(2);
      expect(result.bookedSlots.map((s) => s.slotId).sort()).toEqual([inDay[0]?.id, inDay[3]?.id].sort());
      expect((await slotRows(professional.id)).length).toBe(totalBefore - 2);
      const statuses = (await pool.query("SELECT status, slot_id FROM appointments WHERE slot_id = ANY($1::uuid[])", [[inDay[0]?.id, inDay[3]?.id]])).rows as { status: string; slot_id: string }[];
      expect(statuses.map((s) => s.status).sort()).toEqual(["REQUESTED", "SCHEDULED"]); // marcações intactas, ainda ligadas ao horário
      expect((await u.listTimeOff(actorA, { professionalId: professional.id }))[0]).toMatchObject({ bookedSlotCount: 2, reason: "Férias privadas" });
      expect(JSON.stringify(events.filter((e) => e.action.startsWith("CLINIC_TIME_OFF")))).not.toContain("Férias privadas");

      expect((await u.regenerate(actorA, rule.id, ctx)).generation).toMatchObject({ created: 0, skippedTimeOff: 2 });
      await expect(u.publish(actorA, { date: isoDate(dayStart), times: ["10:00"], professionalId: professional.id, serviceTypeId: service.id }, ctx)).rejects.toMatchObject({ code: "CONFLICT" });

      const { timeOff } = result;
      const regenerated = await u.deleteTimeOff(actorA, timeOff.id, ctx);
      expect(regenerated).toMatchObject({ created: 2, unchanged: 2 });
      expect((await slotRows(professional.id)).length).toBe(totalBefore);
    });

    it("desativar a regra/profissional: removidos os livres futuros, mantidos os marcados (FK e marcação intactas) e o manual", async () => {
      const { u, professional, service } = await newCatalog();
      const { rule } = await u.createRule(actorA, { professionalId: professional.id, serviceTypeId: service.id, weekdays: allDays, startTime: "09:00", endTime: "10:00" }, ctx);
      const rows = await slotRows(professional.id);
      const booked = rows[5];
      await book(booked?.id ?? "");
      const [manual] = await u.publish(actorA, { date: isoDate(utcDay(40)), times: ["18:00"], professionalId: professional.id, serviceTypeId: service.id }, ctx);

      const off = await u.updateRule(actorA, rule.id, { active: false }, ctx);
      expect(off.generation).toMatchObject({ removed: rows.length - 1, keptBooked: 1, created: 0 });
      expect((await slotRows(professional.id)).map((r) => r.id).sort()).toEqual([booked?.id, manual?.id].sort());
      expect((await pool.query("SELECT slot_id, status FROM appointments WHERE slot_id = $1", [booked?.id])).rows).toHaveLength(1);

      // O horário gerado com marcação não se remove individualmente (AC-CLN-11).
      await expect(u.removeSlot(actorA, booked?.id ?? "", ctx)).rejects.toMatchObject({ code: "CONFLICT" });
      await u.removeSlot(actorA, manual?.id ?? "", ctx);

      // Reativar não repõe sozinho; regenerar repõe e o horário marcado conta como unchanged.
      await u.updateRule(actorA, rule.id, { active: true }, ctx).then((r) => { expect(r.generation.created).toBeGreaterThan(0); });
      await u.updateProfessional(actorA, professional.id, { active: false }, ctx);
      expect((await slotRows(professional.id)).map((r) => r.id)).toEqual([booked?.id]);
    });

    it("concorrência: reservar (walk-in) e bloquear o mesmo dia em paralelo — nunca fica uma marcação sem horário nem um horário marcado apagado", async () => {
      const email = `concorrencia-${randomUUID().slice(0, 6)}@example.pt`;
      const userId = randomUUID();
      const memberId = randomUUID();
      await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','Rita Alves','1990-01-01','Europe/Lisbon','ACTIVE','1',now())", [userId, email]);
      await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Rita Alves','1990-01-01','FAMILY_MEMBER')", [memberId, ids.family, userId]);

      const unused = (): never => {
        throw new Error("porta não usada neste teste");
      };
      const walkInDeps: AppointmentsDeps<Kysely<Database>> = {
        appointmentsRepo,
        policy: { can: unused },
        membership: { getMembershipFacts: unused },
        memberNames: { getMemberName: () => Promise.resolve("Rita Alves") },
        clinics: {
          getBookableClinic: async (trx, _f, clinicId) => {
            const clinic = await clinicsRepo.findById(trx, clinicId);
            return clinic ? { id: clinic.id, name: clinic.name } : null;
          },
          listFreeSlots: unused,
          findSlot: async (clinicId, slotId) => {
            const slot = await slotsRepo.findById(db, slotId);
            return slot?.clinicId === clinicId ? slot : null;
          },
          lockSlot: (trx, slotId) => slotsRepo.lockById(trx, slotId),
          listProfessionalSlotsOverlapping: async (trx, professionalId, from, to, excludeSlotId) =>
            (await slotsRepo.listByProfessional(trx, professionalId, { endsAfter: from, startsBefore: to })).filter((s) => s.id !== excludeSlotId).map((s) => s.id),
        },
        examSlotOccupancy: { countScheduledBySlot: () => Promise.resolve([]) },
        prescriptions: { issueForClinic: unused },
        patients: {
          findSelfByEmail: async (trx, e) => {
            const row = await trx.selectFrom("users").innerJoin("family_members", "family_members.user_id", "users.id").select(["users.name as name", "family_members.id as memberId", "family_members.family_id as familyId"]).where("users.email", "=", e).executeTakeFirst();
            return row ? { familyId: row.familyId, memberId: row.memberId, fullName: row.name } : null;
          },
        },
        walkInRateLimiter: new WalkInInMemoryRateLimiter(clock),
        audit: { record: () => Promise.resolve() },
        db,
        withTransaction: (fn) => withTransaction(db, fn),
        clock,
      };
      const walkIn = createCreateWalkInAppointmentUseCase(walkInDeps);

      for (let round = 0; round < 5; round += 1) {
        const { u, professional, service } = await newCatalog();
        await u.createRule(actorA, { professionalId: professional.id, serviceTypeId: service.id, weekdays: allDays, startTime: "09:00", endTime: "10:00", validFrom: isoDate(utcDay(30 + round)), validUntil: isoDate(utcDay(30 + round)) }, ctx);
        const [slot] = await slotRows(professional.id);
        const settled = await Promise.allSettled([
          walkIn({ clinicAccountId: ids.accountA, clinicId: ids.clinicA }, { patientEmail: email, slotId: slot?.id ?? "" }, { requestId: "r", ip: `10.1.0.${String(round)}` }),
          u.createTimeOff(actorA, { professionalId: professional.id, startsAt: utcDay(30 + round).toISOString(), endsAt: utcDay(31 + round).toISOString() }, ctx),
        ]);
        expect(settled[1].status).toBe("fulfilled");
        const timeOff = (settled[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof u.createTimeOff>>>).value;
        const stillThere = (await slotRows(professional.id)).length;
        const bookings = (await pool.query("SELECT status, slot_id FROM appointments WHERE member_id = $1 AND scheduled_at >= $2 AND scheduled_at < $3", [memberId, utcDay(30 + round), utcDay(31 + round)])).rows as { slot_id: string | null }[];
        if (settled[0].status === "fulfilled") {
          // Reserva venceu: o horário ficou, marcado, e o bloqueio listou-o.
          expect(stillThere).toBe(1);
          expect(bookings).toHaveLength(1);
          expect(bookings[0]?.slot_id).toBe(slot?.id);
          expect(timeOff.bookedSlots).toHaveLength(1);
        } else {
          // Bloqueio venceu: horário removido, sem marcação.
          expect(settled[0].reason).toMatchObject({ code: "NOT_FOUND" });
          expect(stillThere).toBe(0);
          expect(bookings).toHaveLength(0);
        }
      }
    });
  });

  describe("walk-in: duração e profissional (BR-CLN-13/16, AC-CLN-12)", () => {
    it("sobreposição do paciente por duração na BD real; a duração fica copiada do horário", async () => {
      const email = `duracao-${randomUUID().slice(0, 6)}@example.pt`;
      const userId = randomUUID();
      const memberId = randomUUID();
      await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','Rui Dias','1990-01-01','Europe/Lisbon','ACTIVE','1',now())", [userId, email]);
      await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Rui Dias','1990-01-01','FAMILY_MEMBER')", [memberId, ids.family, userId]);
      const base = new Date(Date.UTC(2031, 5, 10, 10, 0));
      const mk = async (offsetMin: number, minutes: number) => {
        const id = randomUUID();
        await slotsRepo.insert(db, { id, clinicId: ids.clinicA, kind: "APPOINTMENT", specialty: "Geral", startsAt: new Date(base.getTime() + offsetMin * 60_000), durationMinutes: minutes, capacity: 1, createdAt: new Date() });
        return id;
      };
      const [long60, mid30, after30] = [await mk(0, 60), await mk(30, 30), await mk(60, 30)];
      const unused = (): never => {
        throw new Error("porta não usada");
      };
      const deps = {
        appointmentsRepo,
        clinics: {
          getBookableClinic: () => Promise.resolve({ id: ids.clinicA, name: "Clínica A" }),
          findSlot: async (clinicId: string, slotId: string) => {
            const slot = await slotsRepo.findById(db, slotId);
            return slot?.clinicId === clinicId ? slot : null;
          },
          lockSlot: (trx: Kysely<Database>, slotId: string) => slotsRepo.lockById(trx, slotId),
          listProfessionalSlotsOverlapping: () => Promise.resolve([]),
          listFreeSlots: unused,
        },
        examSlotOccupancy: { countScheduledBySlot: () => Promise.resolve([]) },
        patients: { findSelfByEmail: () => Promise.resolve({ familyId: ids.family, memberId, fullName: "Rui Dias" }) },
        memberNames: { getMemberName: () => Promise.resolve("Rui Dias") },
        walkInRateLimiter: new WalkInInMemoryRateLimiter(clock),
        audit: { record: () => Promise.resolve() },
        db,
        withTransaction: <T>(fn: (trx: Kysely<Database>) => Promise<T>) => withTransaction(db, fn),
        clock,
      } as unknown as AppointmentsDeps<Kysely<Database>>;
      const walkIn = createCreateWalkInAppointmentUseCase(deps);
      const actor = { clinicAccountId: ids.accountA, clinicId: ids.clinicA };

      const first = await walkIn(actor, { patientEmail: email, slotId: long60 }, { requestId: "r", ip: "10.2.0.1" });
      expect((await pool.query("SELECT duration_minutes FROM appointments WHERE id = $1", [first.id])).rows[0]).toEqual({ duration_minutes: 60 });
      await expect(walkIn(actor, { patientEmail: email, slotId: mid30 }, { requestId: "r", ip: "10.2.0.2" })).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(walkIn(actor, { patientEmail: email, slotId: after30 }, { requestId: "r", ip: "10.2.0.3" })).resolves.toMatchObject({ status: "SCHEDULED" });
    });
  });
});
