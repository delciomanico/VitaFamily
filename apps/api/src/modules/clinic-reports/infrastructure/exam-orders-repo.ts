// Implementação Kysely/pg de `ExamOrdersRepository` (schema.md §3h). Isolamento: o portal filtra SEMPRE por `clinic_id`; só a ponte
// (`clinic_exam_order_links`) tem ids Vita e é lida/escrita só pelo lado família/servidor. O pedido é imutável salvo
// `status`, `booked_here`, `cancelled_*`, `updated_at` (nenhuma função deste repositório altera os outros campos).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { ExamOrder, ExamOrderStatus } from "../domain/exam-order.js";
import type { ExamOrdersRepository, FamilyExamOrderRow, NewExamOrderLink, NewExamOrderRecord } from "../application/ports.js";
import "./schema.js";

const COLUMNS = [
  "id",
  "clinic_id",
  "booking_kind",
  "booking_id",
  "clinic_patient_id",
  "name",
  "service_type_id",
  "note",
  "urgent",
  "status",
  "booked_here",
  "patient_name",
  "patient_birth_date",
  "consultation_at",
  "author_name",
  "author_account_id",
  "cancelled_at",
  "created_at",
  "updated_at",
] as const;

interface OrderRow {
  id: string;
  clinic_id: string;
  booking_kind: "APPOINTMENT" | "VISIT";
  booking_id: string;
  clinic_patient_id: string | null;
  name: string;
  service_type_id: string | null;
  note: string | null;
  urgent: boolean;
  status: ExamOrderStatus;
  booked_here: boolean;
  patient_name: string;
  patient_birth_date: string | Date | null;
  consultation_at: Date;
  author_name: string;
  author_account_id: string | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** `pg` devolve `date` como `Date` local; normaliza para `AAAA-MM-DD`. */
function isoDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const y = String(value.getFullYear()).padStart(4, "0");
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toOrder(row: OrderRow): ExamOrder {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    bookingKind: row.booking_kind,
    bookingId: row.booking_id,
    clinicPatientId: row.clinic_patient_id,
    name: row.name,
    serviceTypeId: row.service_type_id,
    note: row.note,
    urgent: row.urgent,
    status: row.status,
    bookedHere: row.booked_here,
    patientName: row.patient_name,
    patientBirthDate: isoDate(row.patient_birth_date),
    consultationAt: row.consultation_at,
    authorName: row.author_name,
    authorAccountId: row.author_account_id,
    cancelledAt: row.cancelled_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyExamOrdersRepository implements ExamOrdersRepository<Kysely<Database>> {
  async lockBooking(trx: Kysely<Database>, bookingId: string): Promise<void> {
    await sql`SELECT pg_advisory_xact_lock(hashtextextended(${bookingId}::text, 0))`.execute(trx);
  }

  async countActive(trx: Kysely<Database>, clinicId: string, bookingId: string): Promise<number> {
    const row = await trx
      .selectFrom("clinic_exam_orders")
      .select(sql<string>`count(*)`.as("count"))
      .where("clinic_id", "=", clinicId)
      .where("booking_id", "=", bookingId)
      .where("status", "<>", "CANCELLED")
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async insert(trx: Kysely<Database>, r: NewExamOrderRecord): Promise<ExamOrder> {
    const row = await trx
      .insertInto("clinic_exam_orders")
      .values({
        id: r.id,
        clinic_id: r.clinicId,
        booking_kind: r.bookingKind,
        booking_id: r.bookingId,
        clinic_patient_id: r.clinicPatientId,
        name: r.name,
        service_type_id: r.serviceTypeId,
        note: r.note,
        urgent: r.urgent,
        patient_name: r.patientName,
        patient_birth_date: r.patientBirthDate,
        consultation_at: r.consultationAt,
        author_name: r.authorName,
        author_account_id: r.authorAccountId,
        created_at: r.now,
        updated_at: r.now,
      })
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
    return toOrder(row);
  }

  async insertLink(trx: Kysely<Database>, link: NewExamOrderLink, now: Date): Promise<void> {
    await trx
      .insertInto("clinic_exam_order_links")
      .values({ order_id: link.orderId, family_id: link.familyId, member_id: link.memberId, appointment_id: link.appointmentId, created_at: now })
      .execute();
  }

  async listByBooking(trx: Kysely<Database>, clinicId: string, bookingId: string): Promise<ExamOrder[]> {
    const rows = await trx.selectFrom("clinic_exam_orders").select(COLUMNS).where("clinic_id", "=", clinicId).where("booking_id", "=", bookingId).orderBy("created_at", "asc").orderBy("id", "asc").execute();
    return rows.map(toOrder);
  }

  async findById(trx: Kysely<Database>, clinicId: string, bookingId: string, orderId: string, lock = false): Promise<ExamOrder | null> {
    let query = trx.selectFrom("clinic_exam_orders").select(COLUMNS).where("clinic_id", "=", clinicId).where("booking_id", "=", bookingId).where("id", "=", orderId);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toOrder(row) : null;
  }

  async cancel(trx: Kysely<Database>, clinicId: string, orderId: string, accountId: string, now: Date): Promise<ExamOrder> {
    const row = await trx
      .updateTable("clinic_exam_orders")
      .set({ status: "CANCELLED", booked_here: false, cancelled_at: now, cancelled_by_account_id: accountId, updated_at: now })
      .where("clinic_id", "=", clinicId)
      .where("id", "=", orderId)
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
    // Desfaz a ligação: o `Examination` do paciente fica intacto (BR-CLN-52).
    await trx.updateTable("clinic_exam_order_links").set({ examination_id: null }).where("order_id", "=", orderId).execute();
    return toOrder(row);
  }

  async activeCountsByBookings(trx: Kysely<Database>, clinicId: string, bookingIds: string[]): Promise<Map<string, number>> {
    if (bookingIds.length === 0) return new Map();
    const rows = await trx
      .selectFrom("clinic_exam_orders")
      .select(["booking_id", sql<string>`count(*)`.as("count")])
      .where("clinic_id", "=", clinicId)
      .where("booking_id", "in", bookingIds)
      .where("status", "<>", "CANCELLED")
      .groupBy("booking_id")
      .execute();
    return new Map(rows.map((r) => [r.booking_id, Number(r.count)]));
  }

  async activeCountsByAppointments(trx: Kysely<Database>, appointmentIds: string[]): Promise<Map<string, number>> {
    if (appointmentIds.length === 0) return new Map();
    const rows = await trx
      .selectFrom("clinic_exam_order_links as l")
      .innerJoin("clinic_exam_orders as o", "o.id", "l.order_id")
      .select(["l.appointment_id", sql<string>`count(*)`.as("count")])
      .where("l.appointment_id", "in", appointmentIds)
      .where("o.status", "<>", "CANCELLED")
      .groupBy("l.appointment_id")
      .execute();
    return new Map(rows.map((r) => [r.appointment_id, Number(r.count)]));
  }

  async listForMember(trx: Kysely<Database>, familyId: string, memberId: string, filter: { status?: ExamOrderStatus; appointmentId?: string }): Promise<FamilyExamOrderRow[]> {
    let query = trx
      .selectFrom("clinic_exam_order_links as l")
      .innerJoin("clinic_exam_orders as o", "o.id", "l.order_id")
      .select(["o.id", "l.appointment_id", "o.clinic_id", "o.name", "o.note", "o.urgent", "o.status", "l.examination_id", "o.created_at"])
      .where("l.family_id", "=", familyId)
      .where("l.member_id", "=", memberId);
    query = filter.status ? query.where("o.status", "=", filter.status) : query.where("o.status", "<>", "CANCELLED");
    if (filter.appointmentId) query = query.where("l.appointment_id", "=", filter.appointmentId);
    const rows = await query.orderBy("o.created_at", "desc").orderBy("o.id", "asc").execute();
    return rows.map((r) => ({
      id: r.id,
      appointmentId: r.appointment_id,
      clinicId: r.clinic_id,
      name: r.name,
      note: r.note,
      urgent: r.urgent,
      status: r.status,
      examinationId: r.examination_id,
      createdAt: r.created_at,
    }));
  }

  async findLinkedForUpdate(trx: Kysely<Database>, familyId: string, memberId: string, orderId: string): Promise<{ order: ExamOrder; examinationId: string | null } | null> {
    const link = await trx.selectFrom("clinic_exam_order_links").select(["order_id", "examination_id"]).where("order_id", "=", orderId).where("family_id", "=", familyId).where("member_id", "=", memberId).executeTakeFirst();
    if (!link) return null;
    const row = await trx.selectFrom("clinic_exam_orders").select(COLUMNS).where("id", "=", orderId).forUpdate().executeTakeFirst();
    return row ? { order: toOrder(row), examinationId: link.examination_id } : null;
  }

  async setLinked(trx: Kysely<Database>, orderId: string, examinationId: string, status: "SCHEDULED" | "FULFILLED", bookedHere: boolean, now: Date): Promise<void> {
    await trx.updateTable("clinic_exam_order_links").set({ examination_id: examinationId }).where("order_id", "=", orderId).execute();
    await trx.updateTable("clinic_exam_orders").set({ status, booked_here: bookedHere, updated_at: now }).where("id", "=", orderId).execute();
  }

  async releaseByExamination(trx: Kysely<Database>, examinationId: string, now: Date): Promise<string | null> {
    const link = await trx.updateTable("clinic_exam_order_links").set({ examination_id: null }).where("examination_id", "=", examinationId).returning("order_id").executeTakeFirst();
    if (!link) return null;
    await trx.updateTable("clinic_exam_orders").set({ status: "ORDERED", booked_here: false, updated_at: now }).where("id", "=", link.order_id).where("status", "<>", "CANCELLED").execute();
    return link.order_id;
  }

  async fulfilByExamination(trx: Kysely<Database>, examinationId: string, now: Date): Promise<string | null> {
    const link = await trx.selectFrom("clinic_exam_order_links").select("order_id").where("examination_id", "=", examinationId).executeTakeFirst();
    if (!link) return null;
    await trx.updateTable("clinic_exam_orders").set({ status: "FULFILLED", updated_at: now }).where("id", "=", link.order_id).where("status", "<>", "CANCELLED").execute();
    return link.order_id;
  }
}
