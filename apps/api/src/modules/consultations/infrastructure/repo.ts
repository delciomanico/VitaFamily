// `BookingRepository` (Kysely/pg). Toda a consulta da família leva (familyId, memberId); o profissional leva `professional_id` (S7).
import { sql, type Kysely } from "kysely";
import { ConflictError } from "../../../platform/errors/index.js";
import type { Database } from "../../../platform/db/index.js";
import type { BookingCancellation, BookingListFilter, BookingRecord, BookingRepository, ProfessionalBookingListFilter } from "../application/ports.js";
import "./schema.js";

type Db = Kysely<Database>;

const COLUMNS = [
  "id", "family_id", "member_id", "professional_id", "offer_id", "specialty_id", "method", "duration_minutes", "price_kz", "starts_at", "ends_at",
  "slot_id", "status", "payment_status", "participant_label", "status_reason", "cancelled_by", "system_reason", "confirmed_at", "completed_at",
  "cancelled_at", "meeting_info", "process_id", "created_by_user_id", "client_request_id", "created_at", "updated_at",
] as const;

interface Row {
  id: string;
  family_id: string;
  member_id: string;
  professional_id: string;
  offer_id: string;
  specialty_id: string;
  method: BookingRecord["method"];
  duration_minutes: number;
  price_kz: number;
  starts_at: Date;
  ends_at: Date;
  slot_id: string | null;
  status: BookingRecord["status"];
  payment_status: BookingRecord["paymentStatus"];
  participant_label: string;
  status_reason: string | null;
  cancelled_by: BookingRecord["cancelledBy"];
  system_reason: BookingRecord["systemReason"];
  confirmed_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  meeting_info: string | null;
  process_id: string | null;
  created_by_user_id: string | null;
  client_request_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export function toBooking(r: Row): BookingRecord {
  return {
    id: r.id,
    familyId: r.family_id,
    memberId: r.member_id,
    professionalId: r.professional_id,
    offerId: r.offer_id,
    specialtyId: r.specialty_id,
    method: r.method,
    durationMinutes: r.duration_minutes,
    priceKz: r.price_kz,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    slotId: r.slot_id,
    status: r.status,
    paymentStatus: r.payment_status,
    participantLabel: r.participant_label,
    statusReason: r.status_reason,
    cancelledBy: r.cancelled_by,
    systemReason: r.system_reason,
    confirmedAt: r.confirmed_at,
    completedAt: r.completed_at,
    cancelledAt: r.cancelled_at,
    meetingInfo: r.meeting_info,
    processId: r.process_id,
    createdByUserId: r.created_by_user_id,
    clientRequestId: r.client_request_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export class KyselyBookingRepository implements BookingRepository<Db> {
  async acquireLocks(trx: Db, keys: readonly string[]): Promise<void> {
    for (const key of [...keys].sort()) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
    }
  }

  async findForFamily(trx: Db, familyId: string, memberId: string, bookingId: string, forUpdate: boolean): Promise<BookingRecord | null> {
    let query = trx.selectFrom("bookings").select(COLUMNS).where("family_id", "=", familyId).where("member_id", "=", memberId).where("id", "=", bookingId);
    if (forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toBooking(row) : null;
  }

  async findByClientRequestId(trx: Db, memberId: string, clientRequestId: string): Promise<BookingRecord | null> {
    const row = await trx.selectFrom("bookings").select(COLUMNS).where("member_id", "=", memberId).where("client_request_id", "=", clientRequestId).executeTakeFirst();
    return row ? toBooking(row) : null;
  }

  async listForMember(trx: Db, familyId: string, memberId: string, filter: BookingListFilter): Promise<BookingRecord[]> {
    let query = trx.selectFrom("bookings").select(COLUMNS).where("family_id", "=", familyId).where("member_id", "=", memberId);
    if (filter.status) query = query.where("status", "=", filter.status);
    if (filter.after) {
      const { startsAt, id } = filter.after;
      query = query.where((eb) => eb.or([eb("starts_at", "<", startsAt), eb.and([eb("starts_at", "=", startsAt), eb("id", "<", id)])]));
    }
    return (await query.orderBy("starts_at", "desc").orderBy("id", "desc").limit(filter.limit).execute()).map(toBooking);
  }

  async listActiveForMember(trx: Db, memberId: string): Promise<{ startsAt: Date; endsAt: Date }[]> {
    const rows = await trx.selectFrom("bookings").select(["starts_at", "ends_at"]).where("member_id", "=", memberId).where("status", "in", ["REQUESTED", "CONFIRMED"]).execute();
    return rows.map((r) => ({ startsAt: r.starts_at, endsAt: r.ends_at }));
  }

  async createTimesByUser(trx: Db, userId: string, since: Date): Promise<Date[]> {
    const rows = await trx.selectFrom("bookings").select("created_at").where("created_by_user_id", "=", userId).where("created_at", ">=", since).execute();
    return rows.map((r) => r.created_at);
  }

  async insert(trx: Db, r: BookingRecord): Promise<void> {
    try {
      await trx
        .insertInto("bookings")
        .values({
          id: r.id,
          family_id: r.familyId,
          member_id: r.memberId,
          professional_id: r.professionalId,
          offer_id: r.offerId,
          specialty_id: r.specialtyId,
          method: r.method,
          duration_minutes: r.durationMinutes,
          price_kz: r.priceKz,
          starts_at: r.startsAt,
          ends_at: r.endsAt,
          slot_id: r.slotId,
          status: r.status,
          payment_status: r.paymentStatus,
          participant_label: r.participantLabel,
          process_id: r.processId,
          created_by_user_id: r.createdByUserId,
          client_request_id: r.clientRequestId,
          created_at: r.createdAt,
          updated_at: r.updatedAt,
        })
        .execute();
    } catch (error) {
      // `EXCLUDE` do membro (sobreposição de marcações ativas): rede de segurança sob corrida.
      if (typeof error === "object" && error !== null && (error as { code?: string }).code === "23P01") {
        throw new ConflictError({ detail: "O membro já tem uma marcação nesse período." });
      }
      throw error;
    }
  }

  async markCancelled(trx: Db, bookingId: string, change: BookingCancellation): Promise<void> {
    await trx
      .updateTable("bookings")
      .set({ status: "CANCELLED", cancelled_by: change.cancelledBy, cancelled_at: change.at, status_reason: change.statusReason, slot_id: null, updated_at: change.at })
      .where("id", "=", bookingId)
      .execute();
  }

  async findForProfessional(trx: Db, professionalId: string, bookingId: string, forUpdate: boolean): Promise<BookingRecord | null> {
    let query = trx.selectFrom("bookings").select(COLUMNS).where("professional_id", "=", professionalId).where("id", "=", bookingId);
    if (forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toBooking(row) : null;
  }

  async listForProfessional(trx: Db, professionalId: string, filter: ProfessionalBookingListFilter): Promise<BookingRecord[]> {
    let query = trx.selectFrom("bookings").select(COLUMNS).where("professional_id", "=", professionalId);
    if (filter.statuses.length > 0) query = query.where("status", "in", filter.statuses);
    if (filter.from) query = query.where("starts_at", ">=", filter.from);
    if (filter.to) query = query.where("starts_at", "<", filter.to);
    if (filter.after) {
      const { startsAt, id } = filter.after;
      query = query.where((eb) => eb.or([eb("starts_at", ">", startsAt), eb.and([eb("starts_at", "=", startsAt), eb("id", ">", id)])]));
    }
    return (await query.orderBy("starts_at", "asc").orderBy("id", "asc").limit(filter.limit).execute()).map(toBooking);
  }

  async markConfirmed(trx: Db, bookingId: string, change: { at: Date; meetingInfo: string | null }): Promise<void> {
    await trx.updateTable("bookings").set({ status: "CONFIRMED", confirmed_at: change.at, meeting_info: change.meetingInfo, updated_at: change.at }).where("id", "=", bookingId).execute();
  }

  async markRejected(trx: Db, bookingId: string, change: { at: Date; reason: string }): Promise<void> {
    await trx.updateTable("bookings").set({ status: "REJECTED", status_reason: change.reason, slot_id: null, updated_at: change.at }).where("id", "=", bookingId).execute();
  }

  async markFinished(trx: Db, bookingId: string, change: { status: "COMPLETED" | "NO_SHOW"; at: Date }): Promise<void> {
    await trx
      .updateTable("bookings")
      .set({ status: change.status, ...(change.status === "COMPLETED" ? { completed_at: change.at } : {}), updated_at: change.at })
      .where("id", "=", bookingId)
      .execute();
  }

  async findById(trx: Db, bookingId: string, forUpdate: boolean): Promise<BookingRecord | null> {
    let query = trx.selectFrom("bookings").select(COLUMNS).where("id", "=", bookingId);
    if (forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toBooking(row) : null;
  }

  async setPaymentStatus(trx: Db, bookingId: string, paymentStatus: BookingRecord["paymentStatus"], at: Date): Promise<void> {
    await trx.updateTable("bookings").set({ payment_status: paymentStatus, updated_at: at }).where("id", "=", bookingId).execute();
  }

  async bookingIdsWithReview(trx: Db, bookingIds: string[]): Promise<Set<string>> {
    if (bookingIds.length === 0) return new Set();
    const rows = await trx.selectFrom("reviews").select("booking_id").where("booking_id", "in", bookingIds).execute();
    return new Set(rows.flatMap((r) => (r.booking_id ? [r.booking_id] : [])));
  }

  async findStateRows(trx: Db, familyId: string, bookingIds: string[]) {
    if (bookingIds.length === 0) return [];
    const rows = await trx
      .selectFrom("bookings as b")
      .select(["b.id", "b.status", "b.payment_status", "b.starts_at", "b.completed_at", "b.updated_at", sql<boolean>`EXISTS (SELECT 1 FROM reviews r WHERE r.booking_id = b.id)`.as("has_review")])
      .where("b.family_id", "=", familyId)
      .where("b.id", "in", bookingIds)
      .execute();
    return rows.map((r) => ({ id: r.id, status: r.status, paymentStatus: r.payment_status, startsAt: r.starts_at, completedAt: r.completed_at, updatedAt: r.updated_at, hasReview: r.has_review }));
  }
}
