// Implementação Kysely/pg das portas de `recommendations` (application/ports.ts). Imutável pela
// aplicação: só `insert` e leituras; a eliminação é por cascata da BD (origem/membro, D15).
import { type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { Recommendation } from "../domain/recommendation.js";
import type { CursorPage, MemberRecommendationFilter, NewRecommendationRecord, OriginFilter, RecommendationsRepository } from "../application/ports.js";
import "./schema.js";

interface RecommendationRow {
  id: string;
  family_id: string;
  member_id: string;
  clinic_id: string | null;
  clinic_name: string;
  clinic_account_id: string | null;
  appointment_id: string | null;
  examination_id: string | null;
  text: string;
  created_at: Date;
}

const COLUMNS = ["id", "family_id", "member_id", "clinic_id", "clinic_name", "clinic_account_id", "appointment_id", "examination_id", "text", "created_at"] as const;

function toRecommendation(row: RecommendationRow): Recommendation {
  const recommendation: Recommendation = {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    clinicName: row.clinic_name,
    text: row.text,
    createdAt: row.created_at,
  };
  if (row.clinic_id !== null) recommendation.clinicId = row.clinic_id;
  if (row.clinic_account_id !== null) recommendation.clinicAccountId = row.clinic_account_id;
  if (row.appointment_id !== null) recommendation.appointmentId = row.appointment_id;
  if (row.examination_id !== null) recommendation.examinationId = row.examination_id;
  return recommendation;
}

export class KyselyRecommendationsRepository implements RecommendationsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewRecommendationRecord): Promise<Recommendation> {
    const row = await trx
      .insertInto("recommendations")
      .values({
        id: record.id,
        family_id: record.familyId,
        member_id: record.memberId,
        clinic_id: record.clinicId,
        clinic_name: record.clinicName,
        clinic_account_id: record.clinicAccountId,
        appointment_id: record.appointmentId ?? null,
        examination_id: record.examinationId ?? null,
        text: record.text,
        created_at: record.createdAt,
      })
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
    return toRecommendation(row);
  }

  async listByClinic(trx: Kysely<Database>, clinicId: string, filter: OriginFilter, limit: number): Promise<Recommendation[]> {
    let query = trx.selectFrom("recommendations").select(COLUMNS).where("clinic_id", "=", clinicId);
    if (filter.appointmentId) query = query.where("appointment_id", "=", filter.appointmentId);
    if (filter.examinationId) query = query.where("examination_id", "=", filter.examinationId);
    const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc").limit(limit).execute();
    return rows.map(toRecommendation);
  }

  async listByMember(trx: Kysely<Database>, familyId: string, memberId: string, filter: MemberRecommendationFilter, limit: number, cursor?: string): Promise<CursorPage<Recommendation>> {
    let query = trx.selectFrom("recommendations").select(COLUMNS).where("family_id", "=", familyId).where("member_id", "=", memberId);
    // Categoria da origem (authorization.md §3): consulta ⇒ APPOINTMENTS, exame ⇒ EXAMS; omite as não permitidas.
    const wantsAppointments = filter.categories.includes("APPOINTMENTS");
    const wantsExams = filter.categories.includes("EXAMS");
    if (wantsAppointments && !wantsExams) query = query.where("appointment_id", "is not", null);
    if (wantsExams && !wantsAppointments) query = query.where("examination_id", "is not", null);
    if (!wantsAppointments && !wantsExams) return { items: [], nextCursor: null };
    if (filter.appointmentId) query = query.where("appointment_id", "=", filter.appointmentId);
    if (filter.examinationId) query = query.where("examination_id", "=", filter.examinationId);
    if (cursor) {
      const decoded = decodeCursor(cursor);
      const before = new Date(decoded.createdAt);
      query = query.where((eb) => eb.or([eb("created_at", "<", before), eb.and([eb("created_at", "=", before), eb("id", "<", decoded.id)])]));
    }
    const rows = await query
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(limit + 1)
      .execute();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id }) : null;
    return { items: page.map(toRecommendation), nextCursor };
  }
}
