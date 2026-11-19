// Integração real (testcontainers + PostgreSQL 16) do escritor de consultas geradas por marcação (MK3 S5, BR-MKT-55, TC-MKT-89):
// migração 0045 (`appointments.booking_id`, UNIQUE parcial `appointments_booking_uq`, FK ON DELETE SET NULL), repositório Kysely real
// e `createFamilyAppointmentWriter` sobre o mesmo PostgreSQL. Não abre Process (usa o da marcação, origem BOOKING).
import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import { Pool } from "pg";
import { GenericContainer, Wait, type StartedTestContainer } from "testcontainers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultMigrationsDir, runMigrations } from "../../db/migrate-runner.js";
import { FixedClock } from "../../src/platform/clock/index.js";
import { createDb, type Database } from "../../src/platform/db/index.js";
import { KyselyAppointmentsRepository } from "../../src/modules/appointments/infrastructure/repo.js";
import { createFamilyAppointmentWriter } from "../../src/modules/appointments/application/family-appointment-writer.js";

interface PgError {
  code?: string;
  constraint?: string;
  message: string;
}

async function erroDe(promessa: Promise<unknown>): Promise<PgError> {
  try {
    await promessa;
  } catch (err) {
    return err as PgError;
  }
  throw new Error("esperava que a operação falhasse");
}

interface Membro {
  familyId: string;
  memberId: string;
}
interface Prof {
  professionalId: string;
  specialtyId: string;
  offerId: string;
  ruleId: string;
}

const INICIO = new Date("2031-01-06T09:00:00.000Z");
const FIM = new Date("2031-01-06T09:30:00.000Z");

describe("integração: escritor de consultas geradas por marcação (MK3 S5, BR-MKT-55)", () => {
  let container: StartedTestContainer;
  let pool: Pool;
  let db: Kysely<Database>;
  const clock = new FixedClock(new Date("2031-01-01T10:00:00.000Z"));
  const writer = createFamilyAppointmentWriter({ appointmentsRepo: new KyselyAppointmentsRepository(), clock });

  async function membro(): Promise<Membro> {
    const userId = randomUUID();
    await pool.query(
      "INSERT INTO users (id, email, password_hash, name, birth_date, timezone, terms_accepted_version, terms_accepted_at) VALUES ($1, $2, 'x', 'U', '1980-01-01', 'Europe/Lisbon', 'v1', now())",
      [userId, `u-${userId}@teste.pt`],
    );
    const familyId = randomUUID();
    const memberId = randomUUID();
    await pool.query("INSERT INTO families (id, name) VALUES ($1, 'F')", [familyId]);
    await pool.query(
      "INSERT INTO family_members (id, family_id, user_id, name, birth_date, role) VALUES ($1,$2,$3,'M','1990-01-01','FAMILY_ADMIN')",
      [memberId, familyId, userId],
    );
    return { familyId, memberId };
  }

  async function profissional(): Promise<Prof> {
    const conta = await pool.query<{ id: string }>(
      "INSERT INTO professional_accounts (email, password_hash, terms_accepted_version, terms_accepted_at) VALUES ($1,'x','1',now()) RETURNING id",
      [`prof-${randomUUID()}@teste.pt`],
    );
    const professionalId = (await pool.query<{ id: string }>("INSERT INTO professionals (account_id) VALUES ($1) RETURNING id", [conta.rows[0]?.id])).rows[0]?.id ?? "";
    const specialtyId = (
      await pool.query<{ id: string }>("INSERT INTO specialties (name, category) VALUES ($1,'HEALTH') RETURNING id", [`Esp ${randomUUID()}`])
    ).rows[0]?.id ?? "";
    await pool.query("INSERT INTO professional_specialties (professional_id, specialty_id) VALUES ($1,$2)", [professionalId, specialtyId]);
    const offerId = (
      await pool.query<{ id: string }>(
        "INSERT INTO professional_offers (professional_id, specialty_id, method, duration_minutes, price_kz) VALUES ($1,$2,'IN_PERSON',30,5000) RETURNING id",
        [professionalId, specialtyId],
      )
    ).rows[0]?.id ?? "";
    const ruleId = (
      await pool.query<{ id: string }>(
        "INSERT INTO professional_schedule_rules (professional_id, offer_id, weekdays, start_time, end_time) VALUES ($1,$2,$3,'09:00','18:00') RETURNING id",
        [professionalId, offerId, [1, 2, 3, 4, 5]],
      )
    ).rows[0]?.id ?? "";
    return { professionalId, specialtyId, offerId, ruleId };
  }

  /** Marcação real (REQUESTED, com horário reservado) — o `booking_id` da consulta aponta para aqui. */
  async function marcacao(m: Membro, p: Prof): Promise<string> {
    const slotId = (
      await pool.query<{ id: string }>(
        "INSERT INTO professional_slots (professional_id, offer_id, rule_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [p.professionalId, p.offerId, p.ruleId, INICIO.toISOString(), FIM.toISOString()],
      )
    ).rows[0]?.id ?? "";
    const id = randomUUID();
    await pool.query(
      `INSERT INTO bookings (id, family_id, member_id, professional_id, offer_id, specialty_id, method, duration_minutes, price_kz,
         starts_at, ends_at, slot_id, status, payment_status, participant_label)
       VALUES ($1,$2,$3,$4,$5,$6,'IN_PERSON',30,5000,$7,$8,$9,'REQUESTED','AWAITING_PROOF','Ana')`,
      [id, m.familyId, m.memberId, p.professionalId, p.offerId, p.specialtyId, INICIO.toISOString(), FIM.toISOString(), slotId],
    );
    await pool.query("UPDATE professional_slots SET booking_id = $1 WHERE id = $2", [id, slotId]);
    return id;
  }

  /** Process da marcação (`processes`, origem BOOKING, BR-PRC-01): o writer recebe o id; não é criado pelo writer. */
  async function processoDaMarcacao(m: Membro, bookingId: string): Promise<string> {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO processes (id, family_id, member_id, kind, origin_type, origin_id, opened_at) VALUES ($1,$2,$3,'ROUTINE','BOOKING',$4,now())",
      [id, m.familyId, m.memberId, bookingId],
    );
    return id;
  }

  async function linhasDaConsulta(bookingId: string): Promise<{ id: string; status: string; booking_id: string | null; process_id: string | null; clinic_id: string | null; professional_name: string | null; specialty: string | null; duration_minutes: number; scheduled_at: Date }[]> {
    const { rows } = await pool.query<{ id: string; status: string; booking_id: string | null; process_id: string | null; clinic_id: string | null; professional_name: string | null; specialty: string | null; duration_minutes: number; scheduled_at: Date }>(
      "SELECT id, status, booking_id, process_id, clinic_id, professional_name, specialty, duration_minutes, scheduled_at FROM appointments WHERE booking_id = $1",
      [bookingId],
    );
    return rows;
  }

  beforeAll(async () => {
    container = await new GenericContainer("postgres:16-alpine")
      .withEnvironment({ POSTGRES_USER: "vita", POSTGRES_PASSWORD: "vita", POSTGRES_DB: "vita" })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    pool = new Pool({ connectionString: `postgres://vita:vita@${container.getHost()}:${String(container.getMappedPort(5432))}/vita`, max: 10 });
    db = createDb(pool);
    await runMigrations(pool, defaultMigrationsDir());
  }, 180_000);

  afterAll(async () => {
    await pool.end();
    await container.stop();
  });

  it("createFromBooking grava booking_id, process_id e os campos copiados da marcação (sem clínica)", async () => {
    const m = await membro();
    const p = await profissional();
    const bookingId = await marcacao(m, p);
    const processId = await processoDaMarcacao(m, bookingId);

    const { appointmentId } = await writer.createFromBooking(db, {
      bookingId,
      processId,
      familyId: m.familyId,
      memberId: m.memberId,
      startsAt: INICIO,
      professionalName: "Dra. Ana Lopes",
      specialty: "Cardiologia",
    });

    const [linha] = await linhasDaConsulta(bookingId);
    expect(linha).toMatchObject({
      id: appointmentId,
      status: "SCHEDULED",
      booking_id: bookingId,
      process_id: processId,
      clinic_id: null,
      professional_name: "Dra. Ana Lopes",
      specialty: "Cardiologia",
      duration_minutes: 30,
    });
    expect(linha?.scheduled_at.toISOString()).toBe(INICIO.toISOString());
  });

  it("createFromBooking com durationMinutes grava a duração copiada da marcação", async () => {
    const m = await membro();
    const p = await profissional();
    const bookingId = await marcacao(m, p);
    const processId = await processoDaMarcacao(m, bookingId);

    await writer.createFromBooking(db, { bookingId, processId, familyId: m.familyId, memberId: m.memberId, startsAt: INICIO, professionalName: "Dr. X", specialty: "Pediatria", durationMinutes: 45 });

    expect((await linhasDaConsulta(bookingId))[0]?.duration_minutes).toBe(45);
  });

  it("é idempotente por bookingId: segunda chamada devolve o mesmo id e não insere outra linha", async () => {
    const m = await membro();
    const p = await profissional();
    const bookingId = await marcacao(m, p);
    const processId = await processoDaMarcacao(m, bookingId);
    const entrada = { bookingId, processId, familyId: m.familyId, memberId: m.memberId, startsAt: INICIO, professionalName: "Dra. Ana", specialty: "Cardiologia" };

    const primeira = await writer.createFromBooking(db, entrada);
    const segunda = await writer.createFromBooking(db, { ...entrada, professionalName: "Outro nome" });

    expect(segunda).toEqual(primeira);
    const linhas = await linhasDaConsulta(bookingId);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]?.professional_name).toBe("Dra. Ana");
  });

  it("UNIQUE parcial appointments_booking_uq: segunda inserção direta com o mesmo booking_id falha; NULL repetido é permitido", async () => {
    const m = await membro();
    const p = await profissional();
    const bookingId = await marcacao(m, p);
    await writer.createFromBooking(db, { bookingId, processId: await processoDaMarcacao(m, bookingId), familyId: m.familyId, memberId: m.memberId, startsAt: INICIO, professionalName: "Dra. Ana", specialty: "Cardiologia" });

    const erro = await erroDe(pool.query("INSERT INTO appointments (family_id, member_id, scheduled_at, booking_id) VALUES ($1,$2,now(),$3)", [m.familyId, m.memberId, bookingId]));
    expect(erro.code).toBe("23505");
    expect(erro.constraint).toBe("appointments_booking_uq");

    await pool.query("INSERT INTO appointments (family_id, member_id, scheduled_at) VALUES ($1,$2,now()), ($1,$2,now())", [m.familyId, m.memberId]);
    expect(await linhasDaConsulta(bookingId)).toHaveLength(1);
  });

  it("findByBookingId devolve a consulta gerada (bookingId e processId) e null para marcação sem consulta", async () => {
    const m = await membro();
    const p = await profissional();
    const bookingId = await marcacao(m, p);
    const processId = await processoDaMarcacao(m, bookingId);
    const { appointmentId } = await writer.createFromBooking(db, { bookingId, processId, familyId: m.familyId, memberId: m.memberId, startsAt: INICIO, professionalName: "Dra. Ana", specialty: "Cardiologia" });

    const repo = new KyselyAppointmentsRepository();
    const encontrada = await repo.findByBookingId(db, bookingId);
    expect(encontrada).toMatchObject({ id: appointmentId, status: "SCHEDULED", bookingId, processId, familyId: m.familyId, memberId: m.memberId });
    expect(encontrada?.clinicId).toBeUndefined();
    expect(await repo.findByBookingId(db, randomUUID())).toBeNull();
  });

  it.each<["COMPLETED" | "NO_SHOW" | "CANCELLED"]>([["COMPLETED"], ["NO_SHOW"], ["CANCELLED"]])("syncFromBooking muda o estado para %s", async (status) => {
    const m = await membro();
    const p = await profissional();
    const bookingId = await marcacao(m, p);
    await writer.createFromBooking(db, { bookingId, processId: await processoDaMarcacao(m, bookingId), familyId: m.familyId, memberId: m.memberId, startsAt: INICIO, professionalName: "Dra. Ana", specialty: "Cardiologia" });

    await writer.syncFromBooking(db, { bookingId, status });

    expect((await linhasDaConsulta(bookingId))[0]?.status).toBe(status);
  });

  it("syncFromBooking sem consulta para a marcação não faz nada e não lança", async () => {
    await expect(writer.syncFromBooking(db, { bookingId: randomUUID(), status: "CANCELLED" })).resolves.toBeUndefined();
  });

  it("apagar a marcação => appointments.booking_id fica NULL (ON DELETE SET NULL) e a consulta mantém-se com o processo", async () => {
    const m = await membro();
    const p = await profissional();
    const bookingId = await marcacao(m, p);
    const processId = await processoDaMarcacao(m, bookingId);
    const { appointmentId } = await writer.createFromBooking(db, { bookingId, processId, familyId: m.familyId, memberId: m.memberId, startsAt: INICIO, professionalName: "Dra. Ana", specialty: "Cardiologia" });

    await pool.query("DELETE FROM bookings WHERE id = $1", [bookingId]);

    const { rows } = await pool.query<{ id: string; booking_id: string | null; process_id: string | null; status: string }>(
      "SELECT id, booking_id, process_id, status FROM appointments WHERE id = $1",
      [appointmentId],
    );
    expect(rows[0]).toEqual({ id: appointmentId, booking_id: null, process_id: processId, status: "SCHEDULED" });
    expect(await linhasDaConsulta(bookingId)).toHaveLength(0);
  });
});
