// `ProofRepository` (SQL puro sobre `payment_proofs`; schema.md §13). Toda a consulta leva a marcação; o ficheiro (`storage_key`) só sobe
// para a `application`, nunca para as vistas.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { DisputeListFilter, DisputeRow, ProofDisputeDecision, ProofRecord, ProofRepository } from "../application/ports.js";
import "./schema.js";

type Db = Kysely<Database>;

interface Row {
  id: string;
  booking_id: string;
  uploaded_by_user_id: string | null;
  storage_key: string;
  content_type: ProofRecord["contentType"];
  size_bytes: number;
  scan_status: ProofRecord["scanStatus"];
  scanned_at: Date | null;
  status: ProofRecord["status"];
  decided_at: Date | null;
  decision_reason: string | null;
  disputed_at: Date | null;
  dispute_note: string | null;
  dispute_decision: ProofRecord["disputeDecision"];
  dispute_decided_at: Date | null;
  purged_at: Date | null;
  created_at: Date;
}

const COLS = sql.raw(
  "id, booking_id, uploaded_by_user_id, storage_key, content_type, size_bytes, scan_status, scanned_at, status, decided_at, decision_reason, disputed_at, dispute_note, dispute_decision, dispute_decided_at, purged_at, created_at",
);

export function toProof(r: Row): ProofRecord {
  return {
    id: r.id,
    bookingId: r.booking_id,
    uploadedByUserId: r.uploaded_by_user_id,
    storageKey: r.storage_key,
    contentType: r.content_type,
    sizeBytes: r.size_bytes,
    scanStatus: r.scan_status,
    scannedAt: r.scanned_at,
    status: r.status,
    decidedAt: r.decided_at,
    decisionReason: r.decision_reason,
    disputedAt: r.disputed_at,
    disputeNote: r.dispute_note,
    disputeDecision: r.dispute_decision,
    disputeDecidedAt: r.dispute_decided_at,
    purgedAt: r.purged_at,
    createdAt: r.created_at,
  };
}

export const PROOF_COLUMNS = COLS;

export class KyselyProofRepository implements ProofRepository<Db> {
  async insert(trx: Db, r: ProofRecord): Promise<void> {
    await sql`INSERT INTO payment_proofs (id, booking_id, uploaded_by_user_id, storage_key, content_type, size_bytes, scan_status, status, created_at)
      VALUES (${r.id}, ${r.bookingId}, ${r.uploadedByUserId}, ${r.storageKey}, ${r.contentType}, ${r.sizeBytes}, 'PENDING', 'SUBMITTED', ${r.createdAt})`.execute(trx);
  }

  async findForBooking(trx: Db, bookingId: string, proofId: string, forUpdate: boolean): Promise<ProofRecord | null> {
    const result = await sql<Row>`SELECT ${COLS} FROM payment_proofs WHERE booking_id = ${bookingId} AND id = ${proofId} ${forUpdate ? sql`FOR UPDATE` : sql``}`.execute(trx);
    return result.rows[0] ? toProof(result.rows[0]) : null;
  }

  async listForBooking(trx: Db, bookingId: string): Promise<ProofRecord[]> {
    const result = await sql<Row>`SELECT ${COLS} FROM payment_proofs WHERE booking_id = ${bookingId} ORDER BY created_at DESC, id DESC`.execute(trx);
    return result.rows.map(toProof);
  }

  async latestForBookings(trx: Db, bookingIds: string[]): Promise<Map<string, ProofRecord>> {
    const map = new Map<string, ProofRecord>();
    if (bookingIds.length === 0) return map;
    const result = await sql<Row>`SELECT DISTINCT ON (booking_id) ${COLS} FROM payment_proofs WHERE booking_id IN (${sql.join(bookingIds)}) ORDER BY booking_id, created_at DESC, id DESC`.execute(trx);
    for (const row of result.rows) map.set(row.booking_id, toProof(row));
    return map;
  }

  async findForScan(trx: Db, proofId: string): Promise<ProofRecord | null> {
    const result = await sql<Row>`SELECT ${COLS} FROM payment_proofs WHERE id = ${proofId}`.execute(trx);
    return result.rows[0] ? toProof(result.rows[0]) : null;
  }

  async listPendingBefore(trx: Db, before: Date, limit: number): Promise<string[]> {
    const result = await sql<{ id: string }>`SELECT id FROM payment_proofs WHERE scan_status = 'PENDING' AND created_at < ${before} ORDER BY created_at ASC, id ASC LIMIT ${limit}`.execute(trx);
    return result.rows.map((r) => r.id);
  }

  async markClean(trx: Db, proofId: string, storageKey: string, at: Date): Promise<void> {
    await sql`UPDATE payment_proofs SET scan_status = 'CLEAN', scanned_at = ${at}, storage_key = ${storageKey} WHERE id = ${proofId}`.execute(trx);
  }

  async deleteProof(trx: Db, proofId: string): Promise<void> {
    await sql`DELETE FROM payment_proofs WHERE id = ${proofId}`.execute(trx);
  }

  async markDecided(trx: Db, proofId: string, change: { status: "CONFIRMED" | "REJECTED"; at: Date; reason: string | null }): Promise<void> {
    await sql`UPDATE payment_proofs SET status = ${change.status}::payment_proof_status, decided_at = ${change.at}, decision_reason = ${change.reason} WHERE id = ${proofId}`.execute(trx);
  }

  async markDisputed(trx: Db, proofId: string, change: { at: Date; note: string | null }): Promise<void> {
    await sql`UPDATE payment_proofs SET status = 'DISPUTED', disputed_at = ${change.at}, dispute_note = ${change.note} WHERE id = ${proofId}`.execute(trx);
  }

  async markDisputeDecided(trx: Db, proofId: string, change: { decision: ProofDisputeDecision; at: Date; decidedBy: string }): Promise<void> {
    const status = change.decision === "CONFIRM_PAYMENT" ? "CONFIRMED" : "REJECTION_UPHELD";
    await sql`UPDATE payment_proofs SET status = ${status}::payment_proof_status, dispute_decision = ${change.decision}::payment_dispute_decision,
      dispute_decided_at = ${change.at}, dispute_decided_by = ${change.decidedBy} WHERE id = ${proofId}`.execute(trx);
  }

  async listDisputes(trx: Db, filter: DisputeListFilter): Promise<DisputeRow[]> {
    const decided = filter.status === "DECIDED";
    const after = filter.after ? sql`AND (p.disputed_at, p.id) > (${filter.after.disputedAt}, ${filter.after.id})` : sql``;
    // Fila por decidir: fora as disputas de marcações terminadas sem consulta (OP-114); só leitura, sem transição.
    const queue = decided ? sql`p.dispute_decision IS NOT NULL` : sql`p.dispute_decision IS NULL AND b.status NOT IN ('CANCELLED', 'REJECTED', 'NO_SHOW')`;
    const result = await sql<JoinedRow>`${JOINED} WHERE p.disputed_at IS NOT NULL AND ${queue} ${after}
      ORDER BY p.disputed_at ASC, p.id ASC LIMIT ${filter.limit}`.execute(trx);
    return result.rows.map(toDispute);
  }

  async findDispute(trx: Db, proofId: string): Promise<DisputeRow | null> {
    const result = await sql<JoinedRow>`${JOINED} WHERE p.id = ${proofId} AND p.disputed_at IS NOT NULL`.execute(trx);
    return result.rows[0] ? toDispute(result.rows[0]) : null;
  }
}

type JoinedRow = Row & { b_id: string; b_professional_id: string; b_specialty_id: string; b_method: DisputeRow["booking"]["method"]; b_duration_minutes: number; b_starts_at: Date; b_price_kz: number; b_status: DisputeRow["booking"]["status"]; b_payment_status: DisputeRow["booking"]["paymentStatus"] };

/** Só colunas de `bookings` que o admin pode ver: nunca `family_id`, `member_id`, `participant_label`. */
const JOINED = sql`SELECT p.id, p.booking_id, p.uploaded_by_user_id, p.storage_key, p.content_type, p.size_bytes, p.scan_status, p.scanned_at, p.status, p.decided_at,
  p.decision_reason, p.disputed_at, p.dispute_note, p.dispute_decision, p.dispute_decided_at, p.purged_at, p.created_at,
  b.id AS b_id, b.professional_id AS b_professional_id, b.specialty_id AS b_specialty_id, b.method AS b_method, b.duration_minutes AS b_duration_minutes,
  b.starts_at AS b_starts_at, b.price_kz AS b_price_kz, b.status AS b_status, b.payment_status AS b_payment_status
  FROM payment_proofs p JOIN bookings b ON b.id = p.booking_id`;

function toDispute(r: JoinedRow): DisputeRow {
  return {
    proof: toProof(r),
    booking: { id: r.b_id, professionalId: r.b_professional_id, specialtyId: r.b_specialty_id, method: r.b_method, durationMinutes: r.b_duration_minutes, startsAt: r.b_starts_at, priceKz: r.b_price_kz, status: r.b_status, paymentStatus: r.b_payment_status },
  };
}
