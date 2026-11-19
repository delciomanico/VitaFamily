// Repositório Kysely das avaliações e denúncias (SQL cru parametrizado, como `proof-repo`). Nunca seleciona colunas de família/membro:
// a tabela `reviews` não as tem (BR-MKT-59/63). Os tipos da BD ficam aqui.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type {
  ReviewAggregateRow,
  ReviewRecord,
  ReviewReportDecision,
  ReviewReportRecord,
  ReviewReportRow,
  ReviewRepository,
} from "../application/review-ports.js";
import "./schema.js";

type Db = Kysely<Database>;

interface Row {
  id: string;
  booking_id: string | null;
  professional_id: string;
  specialty_id: string;
  method: ReviewRecord["method"];
  consulted_month: string;
  rating: number;
  comment: string | null;
  comment_hidden_at: Date | null;
  reply_text: string | null;
  replied_at: Date | null;
  created_at: Date;
  updated_at: Date;
  reported?: boolean;
}

const COLUMNS = sql`r.id, r.booking_id, r.professional_id, r.specialty_id, r.method, to_char(r.consulted_month, 'YYYY-MM-DD') AS consulted_month, r.rating, r.comment,
  r.comment_hidden_at, r.reply_text, r.replied_at, r.created_at, r.updated_at`;
const REPORTED = sql`EXISTS (SELECT 1 FROM review_reports rr WHERE rr.review_id = r.id) AS reported`;

function toReview(r: Row): ReviewRecord {
  return {
    id: r.id,
    bookingId: r.booking_id,
    professionalId: r.professional_id,
    specialtyId: r.specialty_id,
    method: r.method,
    consultedMonth: r.consulted_month,
    rating: r.rating,
    comment: r.comment,
    commentHiddenAt: r.comment_hidden_at,
    replyText: r.reply_text,
    repliedAt: r.replied_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

interface ReportRow {
  rr_id: string;
  rr_review_id: string;
  rr_reason: ReviewReportRecord["reason"];
  rr_note: string | null;
  rr_status: "OPEN" | "DECIDED";
  rr_decision: ReviewReportDecision | null;
  rr_decided_at: Date | null;
  rr_created_at: Date;
}

const REPORT_COLUMNS = sql`rr.id AS rr_id, rr.review_id AS rr_review_id, rr.reason AS rr_reason, rr.note AS rr_note, rr.status AS rr_status,
  rr.decision AS rr_decision, rr.decided_at AS rr_decided_at, rr.created_at AS rr_created_at`;

function toReportRow(r: Row & ReportRow): ReviewReportRow {
  return {
    review: toReview(r),
    report: { id: r.rr_id, reviewId: r.rr_review_id, reason: r.rr_reason, note: r.rr_note, status: r.rr_status, decision: r.rr_decision, decidedAt: r.rr_decided_at, createdAt: r.rr_created_at },
  };
}

const toAggregate = (r: { professional_id: string; n: number; total: number }): ReviewAggregateRow => ({ professionalId: r.professional_id, count: r.n, sum: r.total });

export class KyselyReviewRepository implements ReviewRepository<Db> {
  async findByBooking(trx: Db, bookingId: string, forUpdate: boolean): Promise<ReviewRecord | null> {
    const lock = forUpdate ? sql`FOR UPDATE OF r` : sql``;
    const result = await sql<Row>`SELECT ${COLUMNS} FROM reviews r WHERE r.booking_id = ${bookingId} ${lock}`.execute(trx);
    return result.rows[0] ? toReview(result.rows[0]) : null;
  }

  async insert(trx: Db, r: ReviewRecord): Promise<void> {
    await sql`INSERT INTO reviews (id, booking_id, professional_id, specialty_id, method, consulted_month, rating, comment, created_at, updated_at)
      VALUES (${r.id}, ${r.bookingId}, ${r.professionalId}, ${r.specialtyId}, ${r.method}::offer_method, ${r.consultedMonth}::date, ${r.rating}, ${r.comment}, ${r.createdAt}, ${r.updatedAt})`.execute(trx);
  }

  async update(trx: Db, id: string, change: { rating: number; comment: string | null; at: Date }): Promise<void> {
    await sql`UPDATE reviews SET rating = ${change.rating}, comment = ${change.comment}, updated_at = ${change.at} WHERE id = ${id}`.execute(trx);
  }

  async listForProfessional(
    trx: Db,
    filter: { professionalId: string; specialtyId?: string; unanswered?: boolean; limit: number; after?: { createdAt: Date; id: string } },
  ): Promise<{ review: ReviewRecord; reported: boolean }[]> {
    const specialty = filter.specialtyId ? sql`AND r.specialty_id = ${filter.specialtyId}` : sql``;
    const unanswered = filter.unanswered ? sql`AND r.reply_text IS NULL` : sql``;
    const after = filter.after ? sql`AND (r.created_at, r.id) < (${filter.after.createdAt}, ${filter.after.id})` : sql``;
    const result = await sql<Row>`SELECT ${COLUMNS}, ${REPORTED} FROM reviews r WHERE r.professional_id = ${filter.professionalId} ${specialty} ${unanswered} ${after}
      ORDER BY r.created_at DESC, r.id DESC LIMIT ${filter.limit}`.execute(trx);
    return result.rows.map((r) => ({ review: toReview(r), reported: r.reported === true }));
  }

  async findOfProfessional(trx: Db, professionalId: string, reviewId: string, forUpdate: boolean): Promise<{ review: ReviewRecord; reported: boolean } | null> {
    const lock = forUpdate ? sql`FOR UPDATE OF r` : sql``;
    const result = await sql<Row>`SELECT ${COLUMNS}, ${REPORTED} FROM reviews r WHERE r.id = ${reviewId} AND r.professional_id = ${professionalId} ${lock}`.execute(trx);
    const row = result.rows[0];
    return row ? { review: toReview(row), reported: row.reported === true } : null;
  }

  async setReply(trx: Db, reviewId: string, text: string, at: Date): Promise<boolean> {
    const result = await sql`UPDATE reviews SET reply_text = ${text}, replied_at = ${at} WHERE id = ${reviewId} AND reply_text IS NULL`.execute(trx);
    return Number(result.numAffectedRows ?? 0) > 0;
  }

  async summary(trx: Db, professionalId: string, specialtyId?: string): Promise<{ count: number; sum: number }> {
    const specialty = specialtyId ? sql`AND specialty_id = ${specialtyId}` : sql``;
    const result = await sql<{ n: number; total: number }>`SELECT count(*)::int AS n, COALESCE(sum(rating), 0)::int AS total FROM reviews WHERE professional_id = ${professionalId} ${specialty}`.execute(trx);
    return { count: result.rows[0]?.n ?? 0, sum: result.rows[0]?.total ?? 0 };
  }

  async aggregateForSpecialty(trx: Db, specialtyId: string): Promise<ReviewAggregateRow[]> {
    const result = await sql<{ professional_id: string; n: number; total: number }>`SELECT professional_id, count(*)::int AS n, sum(rating)::int AS total FROM reviews
      WHERE specialty_id = ${specialtyId} GROUP BY professional_id`.execute(trx);
    return result.rows.map(toAggregate);
  }

  async aggregateForProfessionals(trx: Db, professionalIds: readonly string[]): Promise<ReviewAggregateRow[]> {
    if (professionalIds.length === 0) return [];
    const result = await sql<{ professional_id: string; n: number; total: number }>`SELECT professional_id, count(*)::int AS n, sum(rating)::int AS total FROM reviews
      WHERE professional_id = ANY(${professionalIds}::uuid[]) GROUP BY professional_id`.execute(trx);
    return result.rows.map(toAggregate);
  }

  async findReportByReview(trx: Db, reviewId: string): Promise<ReviewReportRecord | null> {
    const result = await sql<ReportRow & Row>`SELECT ${COLUMNS}, ${REPORT_COLUMNS} FROM review_reports rr JOIN reviews r ON r.id = rr.review_id WHERE rr.review_id = ${reviewId}`.execute(trx);
    return result.rows[0] ? toReportRow(result.rows[0]).report : null;
  }

  async insertReport(trx: Db, report: ReviewReportRecord): Promise<boolean> {
    const result = await sql`INSERT INTO review_reports (id, review_id, reason, note, created_at) VALUES (${report.id}, ${report.reviewId}, ${report.reason}::review_report_reason, ${report.note}, ${report.createdAt})
      ON CONFLICT (review_id) DO NOTHING`.execute(trx);
    return Number(result.numAffectedRows ?? 0) > 0;
  }

  async listReports(trx: Db, filter: { status: "OPEN" | "DECIDED"; limit: number; after?: { createdAt: Date; id: string } }): Promise<ReviewReportRow[]> {
    const after = filter.after ? sql`AND (rr.created_at, rr.id) > (${filter.after.createdAt}, ${filter.after.id})` : sql``;
    const result = await sql<ReportRow & Row>`SELECT ${COLUMNS}, ${REPORT_COLUMNS} FROM review_reports rr JOIN reviews r ON r.id = rr.review_id
      WHERE rr.status = ${filter.status}::review_report_status ${after} ORDER BY rr.created_at ASC, rr.id ASC LIMIT ${filter.limit}`.execute(trx);
    return result.rows.map(toReportRow);
  }

  async findReport(trx: Db, reportId: string, forUpdate: boolean): Promise<ReviewReportRow | null> {
    const lock = forUpdate ? sql`FOR UPDATE OF rr` : sql``;
    const result = await sql<ReportRow & Row>`SELECT ${COLUMNS}, ${REPORT_COLUMNS} FROM review_reports rr JOIN reviews r ON r.id = rr.review_id WHERE rr.id = ${reportId} ${lock}`.execute(trx);
    return result.rows[0] ? toReportRow(result.rows[0]) : null;
  }

  async decideReport(trx: Db, reportId: string, change: { decision: ReviewReportDecision; at: Date; decidedBy: string }): Promise<void> {
    await sql`UPDATE review_reports SET status = 'DECIDED', decision = ${change.decision}::review_report_decision, decided_at = ${change.at}, decided_by = ${change.decidedBy} WHERE id = ${reportId}`.execute(trx);
  }

  async hideComment(trx: Db, reviewId: string, at: Date): Promise<void> {
    await sql`UPDATE reviews SET comment_hidden_at = ${at} WHERE id = ${reviewId} AND comment_hidden_at IS NULL`.execute(trx);
  }
}
