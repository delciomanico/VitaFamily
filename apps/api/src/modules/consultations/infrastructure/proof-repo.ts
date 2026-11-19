// `ProofRepository` (SQL puro sobre `payment_proofs`; schema.md §13). Toda a consulta leva a marcação; o ficheiro (`storage_key`) só sobe
// para a `application`, nunca para as vistas.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { ProofRecord, ProofRepository } from "../application/ports.js";
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

  async markClean(trx: Db, proofId: string, storageKey: string, at: Date): Promise<void> {
    await sql`UPDATE payment_proofs SET scan_status = 'CLEAN', scanned_at = ${at}, storage_key = ${storageKey} WHERE id = ${proofId}`.execute(trx);
  }

  async deleteProof(trx: Db, proofId: string): Promise<void> {
    await sql`DELETE FROM payment_proofs WHERE id = ${proofId}`.execute(trx);
  }

  async markDecided(trx: Db, proofId: string, change: { status: "CONFIRMED" | "REJECTED"; at: Date; reason: string | null }): Promise<void> {
    await sql`UPDATE payment_proofs SET status = ${change.status}::payment_proof_status, decided_at = ${change.at}, decision_reason = ${change.reason} WHERE id = ${proofId}`.execute(trx);
  }
}
