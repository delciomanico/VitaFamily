// Implementação Kysely/pg das portas de `appointments` (application/ports.ts). Toda consulta
// exige `familyId`+`memberId` (conventions.md §3.4).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { Appointment, AppointmentStatus, ConfirmationSource, ConfirmationStatus } from "../domain/appointment.js";
import type {
  AppointmentChanges,
  ClinicAppointmentsFilter,
  AppointmentSlotBookingCount,
  AppointmentListFilter,
  AppointmentsRepository,
  ClinicOutcomeChange,
  ClinicStatusChange,
  ConfirmationChange,
  CursorPage,
  DayFlowChange,
  NewAppointmentRecord,
  ReminderWindows,
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
  clinic_outcome_note: string | null;
  outcome_recorded_by_clinic_account_id: string | null;
  outcome_recorded_at: Date | null;
  walk_in: boolean;
  booked_by_clinic_account_id: string | null;
  duration_minutes: number;
  confirmation_status: ConfirmationStatus;
  confirmation_source: ConfirmationSource | null;
  confirmed_at: Date | null;
  arrived_at: Date | null;
  started_at: Date | null;
  followup_due_on: string | null;
  created_at: Date;
}

function toAppointment(row: AppointmentRow): Appointment {
  const appointment: Appointment = {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    scheduledAt: row.scheduled_at,
    status: row.status,
    confirmationStatus: row.confirmation_status,
    createdAt: row.created_at,
  };
  if (row.confirmation_source !== null) appointment.confirmationSource = row.confirmation_source;
  if (row.confirmed_at !== null) appointment.confirmedAt = row.confirmed_at;
  if (row.arrived_at !== null) appointment.arrivedAt = row.arrived_at;
  if (row.started_at !== null) appointment.startedAt = row.started_at;
  if (row.followup_due_on !== null) appointment.followUpDueOn = row.followup_due_on;
  if (row.professional_name !== null) appointment.professionalName = row.professional_name;
  if (row.clinic_id !== null) appointment.clinicId = row.clinic_id;
  if (row.clinic_name !== null) appointment.clinicName = row.clinic_name;
  if (row.specialty !== null) appointment.specialty = row.specialty;
  if (row.reason !== null) appointment.reason = row.reason;
  if (row.notes !== null) appointment.notes = row.notes;
  if (row.slot_id !== null) appointment.slotId = row.slot_id;
  if (row.response_note !== null) appointment.responseNote = row.response_note;
  if (row.clinic_outcome_note !== null) appointment.clinicOutcomeNote = row.clinic_outcome_note;
  if (row.outcome_recorded_by_clinic_account_id !== null) appointment.outcomeRecordedByClinicAccountId = row.outcome_recorded_by_clinic_account_id;
  if (row.outcome_recorded_at !== null) appointment.outcomeRecordedAt = row.outcome_recorded_at;
  if (row.walk_in) appointment.walkIn = true;
  if (row.booked_by_clinic_account_id !== null) appointment.bookedByClinicAccountId = row.booked_by_clinic_account_id;
  appointment.durationMinutes = row.duration_minutes;
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
  "clinic_outcome_note",
  "outcome_recorded_by_clinic_account_id",
  "outcome_recorded_at",
  "walk_in",
  "booked_by_clinic_account_id",
  "duration_minutes",
  "confirmation_status",
  "confirmation_source",
  "confirmed_at",
  "arrived_at",
  "started_at",
  "created_at",
] as const;

/** `date` como texto AAAA-MM-DD (sem conversão de fuso do driver). */
const FOLLOWUP_DUE_ON = sql<string | null>`to_char(followup_due_on, 'YYYY-MM-DD')`.as("followup_due_on");
const APPOINTMENT_SELECT = [...APPOINTMENT_COLUMNS, FOLLOWUP_DUE_ON] as const;

/** BR-CLN-25: reativar (`CANCELLED -> SCHEDULED`) ou mudar `scheduled_at` repõe `PENDING` e anula confirmação/chegada/início. */
const RESET_DAY_FLOW = {
  confirmation_status: "PENDING",
  confirmation_source: null,
  confirmed_at: null,
  arrived_at: null,
  started_at: null,
} as const;

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
        ...(record.durationMinutes !== undefined ? { duration_minutes: record.durationMinutes } : {}),
        ...(record.walkIn ? { walk_in: true, booked_by_clinic_account_id: record.bookedByClinicAccountId ?? null } : {}),
        created_at: record.createdAt,
      })
      .returning(APPOINTMENT_SELECT)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  async findById(trx: Kysely<Database>, familyId: string, memberId: string, appointmentId: string): Promise<Appointment | null> {
    const row = await trx
      .selectFrom("appointments")
      .select(APPOINTMENT_SELECT)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", appointmentId)
      .executeTakeFirst();
    return row ? toAppointment(row) : null;
  }

  async listByMember(trx: Kysely<Database>, familyId: string, memberId: string, filter: AppointmentListFilter, limit: number, cursor?: string): Promise<CursorPage<Appointment>> {
    let query = trx.selectFrom("appointments").select(APPOINTMENT_SELECT).where("family_id", "=", familyId).where("member_id", "=", memberId);
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
        ...(changes.scheduledAt !== undefined ? { scheduled_at: changes.scheduledAt, ...RESET_DAY_FLOW } : {}),
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
      .returning(APPOINTMENT_SELECT)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  async updateStatus(trx: Kysely<Database>, familyId: string, memberId: string, appointmentId: string, status: AppointmentStatus, options: { resetDayFlow?: boolean } = {}): Promise<Appointment> {
    const row = await trx
      .updateTable("appointments")
      .set({
        status,
        // BR-CLN-30 (ST4): sair de `COMPLETED` limpa o retorno; BR-CLN-25: reativar repõe a confirmação.
        ...(status !== "COMPLETED" ? { followup_due_on: null } : {}),
        ...(options.resetDayFlow ? RESET_DAY_FLOW : {}),
        updated_at: sql`now()`,
      })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", appointmentId)
      .returning(APPOINTMENT_SELECT)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  async delete(trx: Kysely<Database>, familyId: string, memberId: string, appointmentId: string): Promise<void> {
    await trx.deleteFrom("appointments").where("family_id", "=", familyId).where("member_id", "=", memberId).where("id", "=", appointmentId).execute();
  }

  async listReminderCandidates(trx: Kysely<Database>, now: Date, windows: ReminderWindows, limit: number): Promise<Appointment[]> {
    // `lookaheadMs` é o limite futuro (nenhum lembrete olha mais longe: 48h do pedido de confirmação, BR-ALR-09; 24h/2h,
    // BR-APT-05) e `outcomeWindowMs` o limiar passado do pedido de desfecho (BR-APT-02).
    const lookahead = new Date(now.getTime() + windows.lookaheadMs);
    const outcomeThreshold = new Date(now.getTime() - windows.outcomeWindowMs);
    // indexes.md: `(status, scheduled_at) WHERE status='SCHEDULED'` — mesmo índice para as duas
    // janelas (futura, lembretes; passada, pedido de desfecho), reaproveitado pelo scanner (M8).
    const rows = await trx
      .selectFrom("appointments")
      .select(APPOINTMENT_SELECT)
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

  /** BR-CLN-30 (`alerts.scan`): consultas `COMPLETED` com retorno em `[from, to]` (AAAA-MM-DD). Índice `(clinic_id, followup_due_on)`. */
  async listFollowUpCandidates(trx: Kysely<Database>, from: string, to: string, limit: number): Promise<Appointment[]> {
    const rows = await trx
      .selectFrom("appointments")
      .select(APPOINTMENT_SELECT)
      .where("status", "=", "COMPLETED")
      .where(sql<boolean>`followup_due_on between ${from}::date and ${to}::date`)
      .orderBy("followup_due_on", "asc")
      .orderBy("id", "asc")
      .limit(limit)
      .execute();
    return rows.map(toAppointment);
  }

  async applyConfirmation(trx: Kysely<Database>, familyId: string, memberId: string, appointmentId: string, change: ConfirmationChange): Promise<Appointment> {
    const row = await trx
      .updateTable("appointments")
      .set({
        confirmation_status: change.confirmationStatus,
        confirmation_source: change.confirmationSource,
        confirmed_at: change.confirmedAt,
        ...(change.cancel ? { status: "CANCELLED" as const, followup_due_on: null } : {}),
        updated_at: sql`now()`,
      })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", appointmentId)
      .returning(APPOINTMENT_SELECT)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  async applyConfirmationByClinic(trx: Kysely<Database>, clinicId: string, appointmentId: string, confirmedAt: Date): Promise<Appointment> {
    const row = await trx
      .updateTable("appointments")
      .set({ confirmation_status: "CONFIRMED", confirmation_source: "CLINIC", confirmed_at: confirmedAt, updated_at: sql`now()` })
      .where("clinic_id", "=", clinicId)
      .where("id", "=", appointmentId)
      .returning(APPOINTMENT_SELECT)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  async applyDayFlow(trx: Kysely<Database>, clinicId: string, appointmentId: string, change: DayFlowChange): Promise<Appointment> {
    const row = await trx
      .updateTable("appointments")
      .set({
        ...(change.status !== undefined ? { status: change.status } : {}),
        ...(change.arrivedAt !== undefined ? { arrived_at: change.arrivedAt } : {}),
        ...(change.startedAt !== undefined ? { started_at: change.startedAt } : {}),
        updated_at: sql`now()`,
      })
      .where("clinic_id", "=", clinicId)
      .where("id", "=", appointmentId)
      .returning(APPOINTMENT_SELECT)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  async setFollowUp(trx: Kysely<Database>, clinicId: string, appointmentId: string, dueOn: string | null): Promise<Appointment> {
    const row = await trx
      .updateTable("appointments")
      .set({ followup_due_on: dueOn, updated_at: sql`now()` })
      .where("clinic_id", "=", clinicId)
      .where("id", "=", appointmentId)
      .returning(APPOINTMENT_SELECT)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  async listFollowUpsByClinic(trx: Kysely<Database>, clinicId: string, until: string, limit: number): Promise<Appointment[]> {
    const rows = await trx
      .selectFrom("appointments")
      .select(APPOINTMENT_SELECT)
      .where("clinic_id", "=", clinicId)
      .where("status", "=", "COMPLETED")
      .where(sql<boolean>`followup_due_on is not null and followup_due_on <= ${until}::date`)
      .orderBy("followup_due_on", "asc")
      .orderBy("id", "asc")
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
      .select(APPOINTMENT_SELECT)
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

  async countActiveBySlot(trx: Kysely<Database>, slotIds: string[]): Promise<AppointmentSlotBookingCount[]> {
    if (slotIds.length === 0) {
      return [];
    }
    const rows = await trx
      .selectFrom("appointments")
      .select(["slot_id", "status", sql<string>`count(*)`.as("total")])
      .where("slot_id", "in", slotIds)
      .where("status", "in", ["REQUESTED", "SCHEDULED"])
      .groupBy(["slot_id", "status"])
      .execute();
    const bySlot = new Map<string, AppointmentSlotBookingCount>();
    for (const row of rows) {
      if (row.slot_id === null) continue;
      const entry = bySlot.get(row.slot_id) ?? { slotId: row.slot_id, requested: 0, scheduled: 0 };
      if (row.status === "REQUESTED") entry.requested += Number(row.total);
      else entry.scheduled += Number(row.total);
      bySlot.set(row.slot_id, entry);
    }
    return [...bySlot.values()];
  }

  async findByClinicId(trx: Kysely<Database>, clinicId: string, appointmentId: string): Promise<Appointment | null> {
    const row = await trx.selectFrom("appointments").select(APPOINTMENT_SELECT).where("clinic_id", "=", clinicId).where("id", "=", appointmentId).executeTakeFirst();
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
      .select(APPOINTMENT_SELECT)
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

  async listForClinic(trx: Kysely<Database>, clinicId: string, filter: ClinicAppointmentsFilter, limit?: number): Promise<Appointment[]> {
    let query = trx.selectFrom("appointments").select(APPOINTMENT_SELECT).where("clinic_id", "=", clinicId);
    if (filter.from) query = query.where("scheduled_at", ">=", filter.from);
    if (filter.to) query = query.where("scheduled_at", "<", filter.to);
    if (filter.familyId && filter.memberId) query = query.where("family_id", "=", filter.familyId).where("member_id", "=", filter.memberId);
    const ordered = limit === undefined ? query.orderBy("scheduled_at", "asc").orderBy("id", "asc") : query.orderBy("scheduled_at", "desc").orderBy("id", "desc").limit(limit);
    return (await ordered.execute()).map(toAppointment);
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
      .returning(APPOINTMENT_SELECT)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  async completeByClinic(trx: Kysely<Database>, appointmentId: string, change: ClinicOutcomeChange): Promise<Appointment> {
    const row = await trx
      .updateTable("appointments")
      .set({
        status: "COMPLETED",
        clinic_outcome_note: change.outcomeNote ?? null,
        outcome_recorded_by_clinic_account_id: change.clinicAccountId,
        outcome_recorded_at: change.recordedAt,
        updated_at: sql`now()`,
      })
      .where("id", "=", appointmentId)
      .returning(APPOINTMENT_SELECT)
      .executeTakeFirstOrThrow();
    return toAppointment(row);
  }

  /** BR-CLN-10/16: consultas `SCHEDULED` do membro cujo intervalo `[scheduled_at, scheduled_at + duração)` sobrepõe `[from, to)` (semiaberto). */
  async findScheduledOverlapping(trx: Kysely<Database>, familyId: string, memberId: string, from: Date, to: Date): Promise<Appointment[]> {
    const rows = await trx
      .selectFrom("appointments")
      .select(APPOINTMENT_SELECT)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("status", "=", "SCHEDULED")
      .where("scheduled_at", "<", to)
      .where(sql<boolean>`scheduled_at + duration_minutes * interval '1 minute' > ${from}`)
      .execute();
    return rows.map(toAppointment);
  }
}
