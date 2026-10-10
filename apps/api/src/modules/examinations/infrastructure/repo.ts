// Implementação Kysely/pg das portas de `examinations` (application/ports.ts). Toda consulta
// de `examinations` exige `familyId`+`memberId` (conventions.md §3.4); `exam_results` não tem
// `family_id`/`member_id` próprios (schema.md §3) — o isolamento vem sempre de verificar a
// `examination` primeiro (ver casos de uso), nunca desta infra isolada.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { ExamResult } from "../domain/exam-result.js";
import type { Examination, ExaminationStatus } from "../domain/examination.js";
import type {
  CursorPage,
  ExaminationChanges,
  ExaminationListFilter,
  ExaminationsRepository,
  ExamResultChanges,
  ExamResultHistoryItem,
  ExamResultsRepository,
  NewExaminationRecord,
  NewExamResultRecord,
} from "../application/ports.js";
import "./schema.js";

interface ExaminationRow {
  id: string;
  family_id: string;
  member_id: string;
  name: string;
  exam_date: string;
  status: ExaminationStatus;
  clinic_id: string | null;
  clinic_name: string | null;
  notes: string | null;
  created_at: Date;
}

function toExamination(row: ExaminationRow): Examination {
  const examination: Examination = {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    name: row.name,
    examDate: row.exam_date,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.clinic_id !== null) examination.clinicId = row.clinic_id;
  if (row.clinic_name !== null) examination.clinicName = row.clinic_name;
  if (row.notes !== null) examination.notes = row.notes;
  return examination;
}

const EXAMINATION_COLUMNS = ["id", "family_id", "member_id", "name", "exam_date", "status", "clinic_id", "clinic_name", "notes", "created_at"] as const;

export class KyselyExaminationsRepository implements ExaminationsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewExaminationRecord): Promise<Examination> {
    const row = await trx
      .insertInto("examinations")
      .values({
        id: record.id,
        family_id: record.familyId,
        member_id: record.memberId,
        name: record.name,
        exam_date: record.examDate,
        status: record.status,
        clinic_id: record.clinicId ?? null,
        clinic_name: record.clinicName ?? null,
        notes: record.notes ?? null,
        created_at: record.createdAt,
      })
      .returning(EXAMINATION_COLUMNS)
      .executeTakeFirstOrThrow();
    return toExamination(row);
  }

  async findById(trx: Kysely<Database>, familyId: string, memberId: string, examinationId: string): Promise<Examination | null> {
    const row = await trx
      .selectFrom("examinations")
      .select(EXAMINATION_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", examinationId)
      .executeTakeFirst();
    return row ? toExamination(row) : null;
  }

  async listByMember(trx: Kysely<Database>, familyId: string, memberId: string, filter: ExaminationListFilter, limit: number, cursor?: string): Promise<CursorPage<Examination>> {
    let query = trx.selectFrom("examinations").select(EXAMINATION_COLUMNS).where("family_id", "=", familyId).where("member_id", "=", memberId);
    if (filter.status) {
      query = query.where("status", "=", filter.status);
    }
    if (filter.from) {
      query = query.where("exam_date", ">=", filter.from);
    }
    if (filter.to) {
      query = query.where("exam_date", "<=", filter.to);
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
    return { items: page.map(toExamination), nextCursor };
  }

  async update(trx: Kysely<Database>, familyId: string, memberId: string, examinationId: string, changes: ExaminationChanges): Promise<Examination> {
    const row = await trx
      .updateTable("examinations")
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.examDate !== undefined ? { exam_date: changes.examDate } : {}),
        ...(changes.clinicId !== undefined ? { clinic_id: changes.clinicId } : {}),
        ...(changes.clinicName !== undefined ? { clinic_name: changes.clinicName } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
        updated_at: sql`now()`,
      })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", examinationId)
      .returning(EXAMINATION_COLUMNS)
      .executeTakeFirstOrThrow();
    return toExamination(row);
  }

  async updateStatus(trx: Kysely<Database>, familyId: string, memberId: string, examinationId: string, status: ExaminationStatus): Promise<Examination> {
    const row = await trx
      .updateTable("examinations")
      .set({ status, updated_at: sql`now()` })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", examinationId)
      .returning(EXAMINATION_COLUMNS)
      .executeTakeFirstOrThrow();
    return toExamination(row);
  }

  async delete(trx: Kysely<Database>, familyId: string, memberId: string, examinationId: string): Promise<void> {
    await trx.deleteFrom("examinations").where("family_id", "=", familyId).where("member_id", "=", memberId).where("id", "=", examinationId).execute();
  }
}

interface ExamResultRow {
  id: string;
  examination_id: string;
  parameter: string;
  value_numeric: string | number | null;
  value_text: string | null;
  unit: string | null;
  reference_min: string | number | null;
  reference_max: string | number | null;
  created_at: Date;
}

function toExamResult(row: ExamResultRow): ExamResult {
  const result: ExamResult = {
    id: row.id,
    examinationId: row.examination_id,
    parameter: row.parameter,
    createdAt: row.created_at,
  };
  if (row.value_numeric !== null) result.valueNumeric = Number(row.value_numeric);
  if (row.value_text !== null) result.valueText = row.value_text;
  if (row.unit !== null) result.unit = row.unit;
  if (row.reference_min !== null) result.referenceMin = Number(row.reference_min);
  if (row.reference_max !== null) result.referenceMax = Number(row.reference_max);
  return result;
}

const EXAM_RESULT_COLUMNS = ["id", "examination_id", "parameter", "value_numeric", "value_text", "unit", "reference_min", "reference_max", "created_at"] as const;

export class KyselyExamResultsRepository implements ExamResultsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewExamResultRecord): Promise<ExamResult> {
    const row = await trx
      .insertInto("exam_results")
      .values({
        id: record.id,
        examination_id: record.examinationId,
        parameter: record.parameter,
        value_numeric: record.valueNumeric ?? null,
        value_text: record.valueText ?? null,
        unit: record.unit ?? null,
        reference_min: record.referenceMin ?? null,
        reference_max: record.referenceMax ?? null,
        created_at: record.createdAt,
      })
      .returning(EXAM_RESULT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toExamResult(row);
  }

  async findById(trx: Kysely<Database>, examinationId: string, resultId: string): Promise<ExamResult | null> {
    const row = await trx.selectFrom("exam_results").select(EXAM_RESULT_COLUMNS).where("examination_id", "=", examinationId).where("id", "=", resultId).executeTakeFirst();
    return row ? toExamResult(row) : null;
  }

  async listByExamination(trx: Kysely<Database>, examinationId: string): Promise<ExamResult[]> {
    const rows = await trx.selectFrom("exam_results").select(EXAM_RESULT_COLUMNS).where("examination_id", "=", examinationId).orderBy("created_at", "asc").execute();
    return rows.map(toExamResult);
  }

  async update(trx: Kysely<Database>, examinationId: string, resultId: string, changes: ExamResultChanges): Promise<ExamResult> {
    const row = await trx
      .updateTable("exam_results")
      .set({
        ...(changes.parameter !== undefined ? { parameter: changes.parameter } : {}),
        ...(changes.valueNumeric !== undefined ? { value_numeric: changes.valueNumeric } : {}),
        ...(changes.valueText !== undefined ? { value_text: changes.valueText } : {}),
        ...(changes.unit !== undefined ? { unit: changes.unit } : {}),
        ...(changes.referenceMin !== undefined ? { reference_min: changes.referenceMin } : {}),
        ...(changes.referenceMax !== undefined ? { reference_max: changes.referenceMax } : {}),
        updated_at: sql`now()`,
      })
      .where("examination_id", "=", examinationId)
      .where("id", "=", resultId)
      .returning(EXAM_RESULT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toExamResult(row);
  }

  async delete(trx: Kysely<Database>, examinationId: string, resultId: string): Promise<void> {
    await trx.deleteFrom("exam_results").where("examination_id", "=", examinationId).where("id", "=", resultId).execute();
  }

  async historyByParameter(trx: Kysely<Database>, familyId: string, memberId: string, parameter: string): Promise<ExamResultHistoryItem[]> {
    const rows = await trx
      .selectFrom("exam_results")
      .innerJoin("examinations", "examinations.id", "exam_results.examination_id")
      .select([
        "examinations.id as examination_id",
        "examinations.exam_date as exam_date",
        "exam_results.value_numeric as value_numeric",
        "exam_results.value_text as value_text",
        "exam_results.unit as unit",
        "exam_results.reference_min as reference_min",
        "exam_results.reference_max as reference_max",
      ])
      .where("examinations.family_id", "=", familyId)
      .where("examinations.member_id", "=", memberId)
      .where("exam_results.parameter", "=", parameter)
      .orderBy("examinations.exam_date", "asc")
      .execute();

    return rows.map((row) => {
      const item: ExamResultHistoryItem = { examinationId: row.examination_id, examDate: row.exam_date };
      if (row.value_numeric !== null) item.valueNumeric = Number(row.value_numeric);
      if (row.value_text !== null) item.valueText = row.value_text;
      if (row.unit !== null) item.unit = row.unit;
      if (row.reference_min !== null) item.referenceMin = Number(row.reference_min);
      if (row.reference_max !== null) item.referenceMax = Number(row.reference_max);
      return item;
    });
  }
}
