// Implementação Kysely/pg das portas de `appointments` (application/ports.ts). Toda consulta
// exige `familyId`+`memberId` (conventions.md §3.4).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { Appointment, AppointmentStatus } from "../domain/appointment.js";
import type {
  AppointmentChanges,
  AppointmentListFilter,
  AppointmentsRepository,
  ClinicStatusChange,
  CursorPage,
  NewAppointmentRecord,
} from "../application/ports.js";
import "./schema.js";

interface AppointmentRow {
  id: string;
  family_id: string;
  member_id: string;
  scheduled_at: Date;
  status: AppointmentStatus;
  professional_name: string | null;
  clinic_id: string | null;
  clinic_name: string | null;
  specialty: string | null;
  reason: string | null;
  notes: string | null;
  slot_id: string | null;
  response_note: string | null;
  created_at: Date;
}

function toAppointment(row: AppointmentRow): Appointment {
  const appointment: Appointment = {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.professional_name !== null) appointment.professionalName = row.professional_name;
  if (row.clinic_id !== null) appointment.clinicId = row.clinic_id;
  if (row.clinic_name !== null) appointment.clinicName = row.clinic_name;
  if (row.specialty !== null) appointment.specialty = row.specialty;
  if (row.reason !== null) appointment.reason = row.reason;
  if (row.notes !== null) appointment.notes = row.notes;
  if (row.slot_id !== null) appointment.slotId = row.slot_id;
  if (row.response_note !== null) appointment.responseNote = row.response_note;
  return appointment;
}

const APPOINTMENT_COLUMNS = [
  "id",
  "family_id",
  "member_id",
  "scheduled_at",
  "status",
  "professional_name",
  "clinic_id",
  "clinic_name",
  "specialty",
  "reason",
  "notes",
  "slot_id",
  "response_note",
  "created_at",
] as const;

export class KyselyAppointmentsRepository implements AppointmentsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewAppointmentRecord): Promise<Appointment> {
    const row = await trx
      .insertInto("appointments")
      .values({
        id: record.id,
        family_id: record.familyId,
        member_id: record.memberId,
        scheduled_at: record.scheduledAt,
        status: record.status,
        professional_name: record.professionalName ?? null,
        clinic_id: record.clinicId ?? null,
        clinic_name: record.clinicName ?? null,
        specialty: record.specialty ?? null,
        reason: record.reason ?? null,
        notes: record.notes ?? null,
        slot_id: record.slotId ?? null,
        created_at: record.createdAt,
      })
      .returning(APPOINTMENT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  async findById(trx: Kysely<Database>, familyId: string, memberId: string, appointmentId: string): Promise<Appointment | null> {
    const row = await trx
      .selectFrom("appointments")
      .select(APPOINTMENT_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", appointmentId)
      .executeTakeFirst();
    return row ? toAppointment(row) : null;
  }

  async listByMember(trx: Kysely<Database>, familyId: string, memberId: string, filter: AppointmentListFilter, limit: number, cursor?: string): Promise<CursorPage<Appointment>> {
    let query = trx.selectFrom("appointments").select(APPOINTMENT_COLUMNS).where("family_id", "=", familyId).where("member_id", "=", memberId);
    if (filter.status) {
      query = query.where("status", "=", filter.status);
    }
    if (filter.from) {
      query = query.where("scheduled_at", ">=", filter.from);
    }
    if (filter.to) {
      query = query.where("scheduled_at", "<=", filter.to);
    }
    if (cursor) {
      const decoded = decodeCursor(cursor);
      const after = new Date(decoded.createdAt);
      query = query.where((eb) => eb.or([eb("created_at", ">", after), eb.and([eb("created_at", "=", after), eb("id", ">", decoded.id)])]));
    }
    const rows = await query
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .limit(limit + 1)
      .execute();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id }) : null;
    return { items: page.map(toAppointment), nextCursor };
  }

  async update(trx: Kysely<Database>, familyId: string, memberId: string, appointmentId: string, changes: AppointmentChanges): Promise<Appointment> {
    const row = await trx
      .updateTable("appointments")
      .set({
        ...(changes.scheduledAt !== undefined ? { scheduled_at: changes.scheduledAt } : {}),
        ...(changes.professionalName !== undefined ? { professional_name: changes.professionalName } : {}),
        ...(changes.clinicId !== undefined ? { clinic_id: changes.clinicId } : {}),
        ...(changes.clinicName !== undefined ? { clinic_name: changes.clinicName } : {}),
        ...(changes.specialty !== undefined ? { specialty: changes.specialty } : {}),
        ...(changes.reason !== undefined ? { reason: changes.reason } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
        updated_at: sql`now()`,
      })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", appointmentId)
      .returning(APPOINTMENT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  async updateStatus(trx: Kysely<Database>, familyId: string, memberId: string, appointmentId: string, status: AppointmentStatus): Promise<Appointment> {
    const row = await trx
      .updateTable("appointments")
      .set({ status, updated_at: sql`now()` })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", appointmentId)
      .returning(APPOINTMENT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  async delete(trx: Kysely<Database>, familyId: string, memberId: string, appointmentId: string): Promise<void> {
    await trx.deleteFrom("appointments").where("family_id", "=", familyId).where("member_id", "=", memberId).where("id", "=", appointmentId).execute();
  }

  async listReminderCandidates(trx: Kysely<Database>, now: Date, outcomeWindowMs: number, limit: number): Promise<Appointment[]> {
    // `outcomeWindowMs` serve as duas janelas (ambas 24h, `alerts/domain/rule.ts`): limite futuro
    // (nenhum lembrete fixo olha mais longe do que isto, BR-APT-05) e limiar passado (BR-APT-02).
    const lookahead = new Date(now.getTime() + outcomeWindowMs);
    const outcomeThreshold = new Date(now.getTime() - outcomeWindowMs);
    // indexes.md: `(status, scheduled_at) WHERE status='SCHEDULED'` — mesmo índice para as duas
    // janelas (futura, lembretes; passada, pedido de desfecho), reaproveitado pelo scanner (M8).
    const rows = await trx
      .selectFrom("appointments")
      .select(APPOINTMENT_COLUMNS)
      .where("status", "=", "SCHEDULED")
      .where((eb) =>
        eb.or([
          eb.and([eb("scheduled_at", ">", now), eb("scheduled_at", "<=", lookahead)]),
          eb.and([eb("scheduled_at", "<=", outcomeThreshold), eb("outcome_requested_at", "is", null)]),
        ]),
      )
      .orderBy("scheduled_at", "asc")
      .limit(limit)
      .execute();
    return rows.map(toAppointment);
  }

  async setOutcomeRequested(trx: Kysely<Database>, appointmentId: string, requestedAt: Date): Promise<void> {
    await trx.updateTable("appointments").set({ outcome_requested_at: requestedAt, updated_at: sql`now()` }).where("id", "=", appointmentId).execute();
  }

  async findActiveBySlot(trx: Kysely<Database>, slotId: string): Promise<Appointment | null> {
    const row = await trx
      .selectFrom("appointments")
      .select(APPOINTMENT_COLUMNS)
      .where("slot_id", "=", slotId)
      .where("status", "in", ["REQUESTED", "SCHEDULED"])
      .executeTakeFirst();
    return row ? toAppointment(row) : null;
  }

  async listActiveSlotIds(trx: Kysely<Database>, slotIds: string[]): Promise<string[]> {
    if (slotIds.length === 0) {
      return [];
    }
    const rows = await trx
      .selectFrom("appointments")
      .select(["slot_id"])
      .where("slot_id", "in", slotIds)
      .where("status", "in", ["REQUESTED", "SCHEDULED"])
      .execute();
    return rows.map((row) => row.slot_id).filter((id): id is string => id !== null);
  }

  async findByClinicId(trx: Kysely<Database>, clinicId: string, appointmentId: string): Promise<Appointment | null> {
    const row = await trx.selectFrom("appointments").select(APPOINTMENT_COLUMNS).where("clinic_id", "=", clinicId).where("id", "=", appointmentId).executeTakeFirst();
    return row ? toAppointment(row) : null;
  }

  async listByClinicAndStatus(
    trx: Kysely<Database>,
    clinicId: string,
    statuses: AppointmentStatus[],
    filter: { from?: Date; to?: Date },
  ): Promise<Appointment[]> {
    let query = trx
      .selectFrom("appointments")
      .select(APPOINTMENT_COLUMNS)
      .where("clinic_id", "=", clinicId)
      .where("status", "in", statuses);
    if (filter.from) {
      query = query.where("scheduled_at", ">=", filter.from);
    }
    if (filter.to) {
      query = query.where("scheduled_at", "<=", filter.to);
    }
    const rows = await query.orderBy("scheduled_at", "asc").execute();
    return rows.map(toAppointment);
  }

  async updateStatusByClinic(trx: Kysely<Database>, appointmentId: string, change: ClinicStatusChange): Promise<Appointment> {
    const row = await trx
      .updateTable("appointments")
      .set({
        status: change.status,
        ...(change.responseNote !== undefined ? { response_note: change.responseNote } : {}),
        updated_at: sql`now()`,
      })
      .where("id", "=", appointmentId)
      .returning(APPOINTMENT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }
}
