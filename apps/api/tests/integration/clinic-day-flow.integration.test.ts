// Integração real (testcontainers + PostgreSQL 16) da etapa Q (migração 0029, BR-CLN-25..30, BR-ALR-09, TC-CLN-13..16):
// linhas antigas ficam PENDING com colunas nulas; ADD VALUE usável depois da migração; CHECKs (DECLINED => CANCELLED, coerência
// da confirmação, started_at >= arrived_at, visitas sem DECLINED/PATIENT); "Não posso" liberta o horário; reativação repõe o
// estado; consultas de candidatos do scanner e da lista de retornos; apagar o membro apaga a consulta e o retorno.
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
import { KyselyAppointmentsRepository } from "../../src/modules/appointments/infrastructure/repo.js";
import { KyselyVisitsRepository } from "../../src/modules/clinic-patients/infrastructure/repo.js";
import { KyselyAlertsRepository } from "../../src/modules/alerts/infrastructure/repo.js";

describe("integração: confirmação, fluxo do dia e retorno (migração 0029)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  let workDir: string;
  const appointments = new KyselyAppointmentsRepository();
  const visits = new KyselyVisitsRepository();
  const clinicId = randomUUID();
  const otherClinicId = randomUUID();
  const NOW = new Date("2026-11-08T12:00:00.000Z");
  const FUTURE = new Date("2026-11-20T10:00:00.000Z");
  const old = { appointment: randomUUID(), visit: randomUUID(), alert: randomUUID(), family: randomUUID(), member: randomUUID(), user: randomUUID(), patient: randomUUID(), slot: randomUUID() };

  async function newMember(name = "Maria") {
    const familyId = randomUUID(), userId = randomUUID(), memberId = randomUUID();
    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x',$3,'1990-01-01','Europe/Lisbon','ACTIVE','1',now())", [userId, `${userId}@example.pt`, name]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam')", [familyId]);
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,$4,'1990-01-01','FAMILY_ADMIN')", [memberId, familyId, userId, name]);
    return { familyId, userId, memberId };
  }
  async function newSlot(startsAt: Date, clinic = clinicId): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO clinic_slots (id, clinic_id, kind, specialty, starts_at, ends_at, duration_minutes, capacity) VALUES ($1,$2,'APPOINTMENT','Cardiologia',$3, $3::timestamptz + interval '30 minutes',30,1)", [id, clinic, startsAt]);
    return id;
  }
  async function newAppointment(m: { familyId: string; memberId: string }, slotId: string | null, startsAt: Date, status = "SCHEDULED", clinic = clinicId): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO appointments (id, family_id, member_id, scheduled_at, status, clinic_id, slot_id) VALUES ($1,$2,$3,$4,$5,$6,$7)", [id, m.familyId, m.memberId, startsAt, status, clinic, slotId]);
    return id;
  }
  async function newPatient(clinic = clinicId): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO clinic_patients (id, clinic_id, name, name_norm, origin) VALUES ($1,$2,'Zé','ze','MANUAL')", [id, clinic]);
    return id;
  }
  async function newVisit(patientId: string, slotId: string | null, startsAt: Date, status = "SCHEDULED"): Promise<string> {
    const id = randomUUID();
    await pool.query("INSERT INTO clinic_visits (id, clinic_id, clinic_patient_id, slot_id, scheduled_at, duration_minutes, status) VALUES ($1,$2,$3,$4,$5,30,$6)", [id, clinicId, patientId, slotId, startsAt, status]);
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

    // 1.º passo: tudo até à 0028 (o estado anterior à etapa Q), com linhas "antigas".
    workDir = await mkdtemp(join(tmpdir(), "vita-mig-"));
    await mkdir(workDir, { recursive: true });
    for (const file of (await readdir(defaultMigrationsDir())).filter((f) => f.endsWith(".sql") && f < "0029")) {
      await copyFile(join(defaultMigrationsDir(), file), join(workDir, file));
    }
    await runMigrations(pool, workDir);
    await pool.query("INSERT INTO clinics (id, type, name) VALUES ($1,'PARTNER','Clínica Sol'), ($2,'PARTNER','Outra')", [clinicId, otherClinicId]);
    await pool.query("INSERT INTO users (id, email, password_hash, name, birth_date, timezone, status, terms_accepted_version, terms_accepted_at) VALUES ($1,$2,'x','Velha','1990-01-01','Europe/Lisbon','ACTIVE','1',now())", [old.user, `${old.user}@example.pt`]);
    await pool.query("INSERT INTO families (id, name) VALUES ($1,'Fam')", [old.family]);
    await pool.query("INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'Velha','1990-01-01','FAMILY_ADMIN')", [old.member, old.family, old.user]);
    await pool.query("INSERT INTO clinic_slots (id, clinic_id, kind, specialty, starts_at, ends_at, duration_minutes, capacity) VALUES ($1,$2,'APPOINTMENT','Cardiologia',$3, $3::timestamptz + interval '30 minutes',30,1)", [old.slot, clinicId, FUTURE]);
    await pool.query("INSERT INTO appointments (id, family_id, member_id, scheduled_at, status, clinic_id, slot_id) VALUES ($1,$2,$3,$4,'SCHEDULED',$5,$6)", [old.appointment, old.family, old.member, FUTURE, clinicId, old.slot]);
    await pool.query("INSERT INTO clinic_patients (id, clinic_id, name, name_norm, origin) VALUES ($1,$2,'Antigo','antigo','MANUAL')", [old.patient, clinicId]);
    await pool.query("INSERT INTO clinic_visits (id, clinic_id, clinic_patient_id, scheduled_at, duration_minutes, status) VALUES ($1,$2,$3,$4,30,'COMPLETED')", [old.visit, clinicId, old.patient, FUTURE]);
    await pool.query("INSERT INTO alerts (id, recipient_user_id, family_id, member_id, type, source_type, source_id, rule_key, dedupe_key, trigger_at) VALUES ($1,$2,$3,$4,'APPOINTMENT_REMINDER','APPOINTMENT',$5,'appointment.24h','k-old',now())", [old.alert, old.user, old.family, old.member, old.appointment]);

    // 2.º passo: a migração da etapa Q sobre dados existentes.
    await runMigrations(pool, defaultMigrationsDir());
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
    await rm(workDir, { recursive: true, force: true });
  });

  it("0029 aplicada (numa só transação, com ADD VALUE); linhas antigas ficam PENDING com as restantes colunas nulas", async () => {
    expect((await pool.query("SELECT version FROM schema_migrations")).rows.map((r: { version: string }) => r.version)).toContain("0029_clinic_day_flow");
    const a: unknown = (await pool.query("SELECT confirmation_status, confirmation_source, confirmed_at, arrived_at, started_at, followup_due_on, status FROM appointments WHERE id = $1", [old.appointment])).rows[0];
    expect(a).toEqual({ confirmation_status: "PENDING", confirmation_source: null, confirmed_at: null, arrived_at: null, started_at: null, followup_due_on: null, status: "SCHEDULED" });
    const v: unknown = (await pool.query("SELECT confirmation_status, confirmation_source, arrived_at, followup_due_on, status FROM clinic_visits WHERE id = $1", [old.visit])).rows[0];
    expect(v).toEqual({ confirmation_status: "PENDING", confirmation_source: null, arrived_at: null, followup_due_on: null, status: "COMPLETED" });
  });

  it("os valores de enum novos aceitam-se depois da migração (visita NO_SHOW, alertas APPOINTMENT_CONFIRM_REQUEST e FOLLOWUP_REMINDER)", async () => {
    const slot = await newSlot(FUTURE);
    const patient = await newPatient();
    const visit = await newVisit(patient, slot, FUTURE, "NO_SHOW");
    expect((await pool.query("SELECT status FROM clinic_visits WHERE id = $1", [visit])).rows[0]).toEqual({ status: "NO_SHOW" });
    for (const [type, key] of [["APPOINTMENT_CONFIRM_REQUEST", "appointment.confirm48h"], ["FOLLOWUP_REMINDER", "followup.due"]] as const) {
      await pool.query("INSERT INTO alerts (recipient_user_id, family_id, member_id, type, source_type, source_id, rule_key, dedupe_key, trigger_at) VALUES ($1,$2,$3,$4,'APPOINTMENT',$5,$6,$7,now())", [old.user, old.family, old.member, type, old.appointment, key, `k-${type}`]);
    }
    expect((await pool.query("SELECT count(*)::int AS n FROM alerts WHERE type IN ('APPOINTMENT_CONFIRM_REQUEST','FOLLOWUP_REMINDER')")).rows[0]).toEqual({ n: 2 });
  });

  it("CHECKs de appointments: DECLINED => CANCELLED, coerência da confirmação, started_at >= arrived_at", async () => {
    const m = await newMember();
    const slot = await newSlot(FUTURE);
    const id = await newAppointment(m, slot, FUTURE);
    await expect(pool.query("UPDATE appointments SET confirmation_status='DECLINED' WHERE id=$1", [id])).rejects.toThrow(/declined_cancelled_check/);
    await expect(pool.query("UPDATE appointments SET confirmation_status='CONFIRMED' WHERE id=$1", [id])).rejects.toThrow(/confirmation_coherence_check/);
    await expect(pool.query("UPDATE appointments SET confirmation_source='CLINIC', confirmed_at=now() WHERE id=$1", [id])).rejects.toThrow(/confirmation_coherence_check/);
    await expect(pool.query("UPDATE appointments SET started_at=now() WHERE id=$1", [id])).rejects.toThrow(/started_after_arrived_check/);
    await expect(pool.query("UPDATE appointments SET arrived_at=now(), started_at=now() - interval '1 minute' WHERE id=$1", [id])).rejects.toThrow(/started_after_arrived_check/);
    await pool.query("UPDATE appointments SET confirmation_status='CONFIRMED', confirmation_source='PATIENT', confirmed_at=now(), arrived_at=now(), started_at=now() WHERE id=$1", [id]);
    await pool.query("UPDATE appointments SET status='CANCELLED', confirmation_status='DECLINED', confirmation_source=NULL, confirmed_at=NULL WHERE id=$1", [id]);
  });

  it("CHECKs de clinic_visits: nunca DECLINED, origem só CLINIC, mesma coerência e ordem chegada/início", async () => {
    const patient = await newPatient();
    const id = await newVisit(patient, null, FUTURE);
    await expect(pool.query("UPDATE clinic_visits SET confirmation_status='DECLINED' WHERE id=$1", [id])).rejects.toThrow(/no_declined_check|coherence/);
    await expect(pool.query("UPDATE clinic_visits SET confirmation_status='CONFIRMED', confirmation_source='PATIENT', confirmed_at=now() WHERE id=$1", [id])).rejects.toThrow(/source_clinic_check/);
    await expect(pool.query("UPDATE clinic_visits SET confirmation_status='CONFIRMED' WHERE id=$1", [id])).rejects.toThrow(/coherence/);
    await expect(pool.query("UPDATE clinic_visits SET started_at=now() WHERE id=$1", [id])).rejects.toThrow(/started_after_arrived_check/);
    await pool.query("UPDATE clinic_visits SET confirmation_status='CONFIRMED', confirmation_source='CLINIC', confirmed_at=now() WHERE id=$1", [id]);
  });

  it("'Não posso' (applyConfirmation cancel) liberta o horário: outro paciente reserva-o a seguir; a unicidade do horário mantém-se antes", async () => {
    const m1 = await newMember();
    const m2 = await newMember();
    const slot = await newSlot(FUTURE);
    const id = await newAppointment(m1, slot, FUTURE);
    await expect(newAppointment(m2, slot, FUTURE)).rejects.toThrow(/slot_active_booking/);
    const declined = await withTransaction(db, (trx) => appointments.applyConfirmation(trx, m1.familyId, m1.memberId, id, { confirmationStatus: "DECLINED", confirmationSource: null, confirmedAt: null, cancel: true }));
    expect(declined).toMatchObject({ status: "CANCELLED", confirmationStatus: "DECLINED" });
    await newAppointment(m2, slot, FUTURE);
    // isolamento por membro: a escrita exige família+membro corretos
    await expect(withTransaction(db, (trx) => appointments.applyConfirmation(trx, m2.familyId, m1.memberId, id, { confirmationStatus: "CONFIRMED", confirmationSource: "PATIENT", confirmedAt: NOW }))).rejects.toThrow();
  });

  it("reativar repõe PENDING e anula chegada/início; sair de COMPLETED limpa o retorno; mudar scheduled_at repõe", async () => {
    const m = await newMember();
    const slot = await newSlot(FUTURE);
    const id = await newAppointment(m, slot, FUTURE);
    await withTransaction(db, async (trx) => {
      await appointments.applyConfirmationByClinic(trx, clinicId, id, NOW);
      await appointments.applyDayFlow(trx, clinicId, id, { arrivedAt: NOW, startedAt: NOW });
    });
    const confirmed = await withTransaction(db, (trx) => appointments.findByClinicId(trx, clinicId, id));
    expect(confirmed).toMatchObject({ confirmationStatus: "CONFIRMED", confirmationSource: "CLINIC" });
    await withTransaction(db, (trx) => appointments.updateStatus(trx, m.familyId, m.memberId, id, "CANCELLED"));
    const reactivated = await withTransaction(db, (trx) => appointments.updateStatus(trx, m.familyId, m.memberId, id, "SCHEDULED", { resetDayFlow: true }));
    expect(reactivated).toMatchObject({ status: "SCHEDULED", confirmationStatus: "PENDING" });
    expect(reactivated.arrivedAt).toBeUndefined();
    expect(reactivated.startedAt).toBeUndefined();

    await withTransaction(db, async (trx) => {
      await appointments.applyDayFlow(trx, clinicId, id, { arrivedAt: NOW });
      await appointments.updateStatus(trx, m.familyId, m.memberId, id, "COMPLETED");
      await appointments.setFollowUp(trx, clinicId, id, "2027-01-31");
    });
    expect((await withTransaction(db, (trx) => appointments.findByClinicId(trx, clinicId, id)))?.followUpDueOn).toBe("2027-01-31");
    const corrected = await withTransaction(db, (trx) => appointments.updateStatus(trx, m.familyId, m.memberId, id, "NO_SHOW"));
    expect(corrected.followUpDueOn).toBeUndefined();

    const moved = await withTransaction(db, async (trx) => {
      await appointments.updateStatus(trx, m.familyId, m.memberId, id, "SCHEDULED");
      await appointments.applyConfirmationByClinic(trx, clinicId, id, NOW);
      return appointments.update(trx, m.familyId, m.memberId, id, { scheduledAt: new Date("2026-11-21T10:00:00.000Z") });
    });
    expect(moved).toMatchObject({ confirmationStatus: "PENDING" });
    expect(moved.confirmedAt).toBeUndefined();
  });

  it("candidatos do scanner: janela de 48 h inclui consultas SCHEDULED futuras; retornos entre datas; lista de retornos da clínica por data e isolada", async () => {
    const m = await newMember();
    const soon = new Date(NOW.getTime() + 47 * 3_600_000);
    const later = new Date(NOW.getTime() + 49 * 3_600_000);
    const slotSoon = await newSlot(soon);
    const slotLater = await newSlot(later);
    const idSoon = await newAppointment(m, slotSoon, soon);
    const idLater = await newAppointment(m, slotLater, later);
    const candidates = await withTransaction(db, (trx) => appointments.listReminderCandidates(trx, NOW, { lookaheadMs: 48 * 3_600_000, outcomeWindowMs: 24 * 3_600_000 }, 500));
    const ids = candidates.map((c) => c.id);
    expect(ids).toContain(idSoon);
    expect(ids).not.toContain(idLater);
    expect(candidates.find((c) => c.id === idSoon)).toMatchObject({ confirmationStatus: "PENDING", slotId: slotSoon });

    const done1 = await newAppointment(m, null, new Date("2026-10-01T10:00:00.000Z"), "COMPLETED");
    const done2 = await newAppointment(m, null, new Date("2026-10-02T10:00:00.000Z"), "COMPLETED");
    const doneOther = await newAppointment(m, null, new Date("2026-10-03T10:00:00.000Z"), "COMPLETED", otherClinicId);
    await withTransaction(db, async (trx) => {
      await appointments.setFollowUp(trx, clinicId, done1, "2026-11-20");
      await appointments.setFollowUp(trx, clinicId, done2, "2026-11-10");
      await appointments.setFollowUp(trx, otherClinicId, doneOther, "2026-11-09");
    });
    const followUps = await withTransaction(db, (trx) => appointments.listFollowUpCandidates(trx, "2026-11-08", "2026-11-15", 500));
    expect(followUps.map((f) => f.id)).toEqual(expect.arrayContaining([done2, doneOther]));
    expect(followUps.map((f) => f.id)).not.toContain(done1);
    const mine = await withTransaction(db, (trx) => appointments.listFollowUpsByClinic(trx, clinicId, "2026-11-30", 200));
    expect(mine.map((f) => f.id).filter((id) => [done1, done2, doneOther].includes(id))).toEqual([done2, done1]);
    expect(mine.map((f) => f.followUpDueOn).slice(-2)).toEqual(["2026-11-10", "2026-11-20"]);

    // alerts: a mesma chave idempotente não duplica (índice único)
    const alertsRepo = new KyselyAlertsRepository();
    const record = { id: randomUUID(), recipientUserId: m.userId, familyId: m.familyId, memberId: m.memberId, type: "APPOINTMENT_CONFIRM_REQUEST" as const, sourceType: "APPOINTMENT" as const, sourceId: idSoon, ruleKey: "appointment.confirm48h" as const, dedupeKey: `appointment.confirm48h:${idSoon}`, triggerAt: NOW, createdAt: NOW };
    expect(await withTransaction(db, (trx) => alertsRepo.insertIfNew(trx, record))).not.toBeNull();
    expect(await withTransaction(db, (trx) => alertsRepo.insertIfNew(trx, { ...record, id: randomUUID() }))).toBeNull();
  });

  it("visitas: confirmar, chegar/iniciar, falta (liberta o índice do horário) e chegada tardia (conflito se o horário foi retomado)", async () => {
    const patient = await newPatient();
    const slot = await newSlot(FUTURE);
    const id = await newVisit(patient, slot, FUTURE);
    const confirmed = await withTransaction(db, (trx) => visits.applyConfirmation(trx, clinicId, id, NOW));
    expect(confirmed).toMatchObject({ confirmationStatus: "CONFIRMED" });
    const started = await withTransaction(db, (trx) => visits.applyDayFlow(trx, clinicId, id, { arrivedAt: NOW, startedAt: NOW }, NOW));
    expect(started).toMatchObject({ status: "SCHEDULED" });
    expect(started.startedAt?.toISOString()).toBe(NOW.toISOString());
    // NO_SHOW: a visita deixa de ocupar o índice parcial; outra visita pode ficar no mesmo horário
    const noShowId = await newVisit(patient, await newSlot(new Date("2026-11-21T10:00:00.000Z")), new Date("2026-11-21T10:00:00.000Z"));
    const noShowSlot = ((await pool.query("SELECT slot_id FROM clinic_visits WHERE id=$1", [noShowId])).rows[0] as { slot_id: string }).slot_id;
    await withTransaction(db, (trx) => visits.applyDayFlow(trx, clinicId, noShowId, { status: "NO_SHOW" }, NOW));
    await newVisit(patient, noShowSlot, new Date("2026-11-21T10:00:00.000Z"));
    await expect(withTransaction(db, (trx) => visits.applyDayFlow(trx, clinicId, noShowId, { status: "SCHEDULED", arrivedAt: NOW }, NOW))).rejects.toMatchObject({ code: "CONFLICT" });
    // setStatus fora de COMPLETED limpa o retorno; retorno de visita COMPLETED lista-se por data
    const doneId = await newVisit(patient, null, new Date("2026-10-05T10:00:00.000Z"), "COMPLETED");
    await withTransaction(db, (trx) => visits.setFollowUp(trx, clinicId, doneId, "2026-11-12", NOW));
    expect((await withTransaction(db, (trx) => visits.listFollowUps(trx, clinicId, "2026-11-30", 200))).map((v) => [v.id, v.followUpDueOn])).toContainEqual([doneId, "2026-11-12"]);
    expect(await withTransaction(db, (trx) => visits.listFollowUps(trx, otherClinicId, "2026-11-30", 200))).toEqual([]);
  });

  it("apagar o membro apaga a consulta e, com ela, o retorno e a confirmação (D15, BR-CLN-24); a visita e o registo da clínica não", async () => {
    const m = await newMember();
    const id = await newAppointment(m, null, new Date("2026-10-01T10:00:00.000Z"), "COMPLETED");
    await withTransaction(db, (trx) => appointments.setFollowUp(trx, clinicId, id, "2026-12-01"));
    const patient = await newPatient();
    const visit = await newVisit(patient, null, new Date("2026-10-01T10:00:00.000Z"), "COMPLETED");
    await pool.query("DELETE FROM family_members WHERE id = $1", [m.memberId]);
    expect((await pool.query("SELECT count(*)::int AS n FROM appointments WHERE id = $1", [id])).rows[0]).toEqual({ n: 0 });
    expect((await pool.query("SELECT count(*)::int AS n FROM clinic_visits WHERE id = $1", [visit])).rows[0]).toEqual({ n: 1 });
  });
});
