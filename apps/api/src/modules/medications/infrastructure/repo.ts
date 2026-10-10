// Implementação Kysely/pg das portas de `medications` (application/ports.ts). Toda consulta por
// membro exige `familyId`+`memberId` (conventions.md §3.4); as dos jobs (`listActiveForGeneration`,
// `listPendingBefore`) são operações de sistema sem `familyId` (modules.md §4, worker).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { DoseOccurrence, DoseStatus } from "../domain/dose-occurrence.js";
import type { MedicationPlan, PlanStatus, ScheduleType } from "../domain/medication-plan.js";
import type {
  AdherenceItem,
  CursorPage,
  DoseListFilter,
  DoseOccurrencesRepository,
  MedicationPlanChanges,
  MedicationPlanListFilter,
  MedicationPlansRepository,
  NewDoseOccurrenceRecord,
  NewMedicationPlanRecord,
} from "../application/ports.js";
import "./schema.js";

interface PlanRow {
  id: string;
  family_id: string;
  member_id: string;
  prescription_id: string | null;
  name: string;
  dosage: string;
  schedule_type: ScheduleType;
  times: string[] | null;
  days_of_week: number[] | null;
  interval_hours: number | null;
  start_at: Date;
  end_at: Date | null;
  continuous: boolean;
  notes: string | null;
  status: PlanStatus;
  ended_at: Date | null;
  created_at: Date;
}

function toPlan(row: PlanRow): MedicationPlan {
  const plan: MedicationPlan = {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    name: row.name,
    dosage: row.dosage,
    scheduleType: row.schedule_type,
    startAt: row.start_at,
    continuous: row.continuous,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.prescription_id !== null) plan.prescriptionId = row.prescription_id;
  if (row.times !== null) plan.times = row.times;
  if (row.days_of_week !== null) plan.daysOfWeek = row.days_of_week;
  if (row.interval_hours !== null) plan.intervalHours = row.interval_hours;
  if (row.end_at !== null) plan.endAt = row.end_at;
  if (row.notes !== null) plan.notes = row.notes;
  if (row.ended_at !== null) plan.endedAt = row.ended_at;
  return plan;
}

const PLAN_COLUMNS = [
  "id",
  "family_id",
  "member_id",
  "prescription_id",
  "name",
  "dosage",
  "schedule_type",
  "times",
  "days_of_week",
  "interval_hours",
  "start_at",
  "end_at",
  "continuous",
  "notes",
  "status",
  "ended_at",
  "created_at",
] as const;

interface DoseRow {
  id: string;
  family_id: string;
  member_id: string;
  plan_id: string;
  scheduled_at: Date;
  status: DoseStatus;
  acted_at: Date | null;
  acted_by_user_id: string | null;
  note: string | null;
  generation_version: number;
  created_at: Date;
  medication_name: string;
  dosage: string;
}

function toDose(row: DoseRow): DoseOccurrence {
  const dose: DoseOccurrence = {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    planId: row.plan_id,
    medicationName: row.medication_name,
    dosage: row.dosage,
    scheduledAt: row.scheduled_at,
    status: row.status,
    generationVersion: row.generation_version,
    createdAt: row.created_at,
  };
  if (row.acted_at !== null) dose.actedAt = row.acted_at;
  if (row.acted_by_user_id !== null) dose.actedByUserId = row.acted_by_user_id;
  if (row.note !== null) dose.note = row.note;
  return dose;
}

export class KyselyMedicationPlansRepository implements MedicationPlansRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewMedicationPlanRecord): Promise<MedicationPlan> {
    const row = await trx
      .insertInto("medication_plans")
      .values({
        id: record.id,
        family_id: record.familyId,
        member_id: record.memberId,
        prescription_id: record.prescriptionId ?? null,
        name: record.name,
        dosage: record.dosage,
        schedule_type: record.scheduleType,
        times: record.times ?? null,
        days_of_week: record.daysOfWeek ?? null,
        interval_hours: record.intervalHours ?? null,
        start_at: record.startAt,
        end_at: record.endAt ?? null,
        continuous: record.continuous,
        notes: record.notes ?? null,
        status: "ACTIVE",
        created_at: record.createdAt,
      })
      .returning(PLAN_COLUMNS)
      .executeTakeFirstOrThrow();
    return toPlan(row);
  }

  async findById(trx: Kysely<Database>, familyId: string, memberId: string, planId: string): Promise<MedicationPlan | null> {
    const row = await trx
      .selectFrom("medication_plans")
      .select(PLAN_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", planId)
      .executeTakeFirst();
    return row ? toPlan(row) : null;
  }

  async listByMember(
    trx: Kysely<Database>,
    familyId: string,
    memberId: string,
    filter: MedicationPlanListFilter,
    limit: number,
    cursor?: string,
  ): Promise<CursorPage<MedicationPlan>> {
    let query = trx.selectFrom("medication_plans").select(PLAN_COLUMNS).where("family_id", "=", familyId).where("member_id", "=", memberId);
    if (filter.status) {
      query = query.where("status", "=", filter.status);
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
    return toCursorPage(rows, limit, toPlan);
  }

  async listByPrescription(trx: Kysely<Database>, familyId: string, memberId: string, prescriptionId: string): Promise<MedicationPlan[]> {
    const rows = await trx
      .selectFrom("medication_plans")
      .select(PLAN_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("prescription_id", "=", prescriptionId)
      .orderBy("created_at", "asc")
      .execute();
    return rows.map(toPlan);
  }

  async update(trx: Kysely<Database>, familyId: string, memberId: string, planId: string, changes: MedicationPlanChanges): Promise<MedicationPlan> {
    const row = await trx
      .updateTable("medication_plans")
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.dosage !== undefined ? { dosage: changes.dosage } : {}),
        ...(changes.scheduleType !== undefined ? { schedule_type: changes.scheduleType } : {}),
        ...(changes.times !== undefined ? { times: changes.times } : {}),
        ...(changes.daysOfWeek !== undefined ? { days_of_week: changes.daysOfWeek } : {}),
        ...(changes.intervalHours !== undefined ? { interval_hours: changes.intervalHours } : {}),
        ...(changes.endAt !== undefined ? { end_at: changes.endAt } : {}),
        ...(changes.continuous !== undefined ? { continuous: changes.continuous } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
        updated_at: sql`now()`,
      })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", planId)
      .returning(PLAN_COLUMNS)
      .executeTakeFirstOrThrow();
    return toPlan(row);
  }

  async updateStatus(trx: Kysely<Database>, familyId: string, memberId: string, planId: string, status: PlanStatus, endedAt: Date | null): Promise<MedicationPlan> {
    const row = await trx
      .updateTable("medication_plans")
      .set({ status, ended_at: endedAt, updated_at: sql`now()` })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", planId)
      .returning(PLAN_COLUMNS)
      .executeTakeFirstOrThrow();
    return toPlan(row);
  }

  async delete(trx: Kysely<Database>, familyId: string, memberId: string, planId: string): Promise<void> {
    await trx.deleteFrom("medication_plans").where("family_id", "=", familyId).where("member_id", "=", memberId).where("id", "=", planId).execute();
  }

  async listActiveForGeneration(trx: Kysely<Database>, now: Date): Promise<MedicationPlan[]> {
    const rows = await trx
      .selectFrom("medication_plans")
      .select(PLAN_COLUMNS)
      .where("status", "=", "ACTIVE")
      .where((eb) => eb.or([eb("end_at", "is", null), eb("end_at", ">", now)]))
      .execute();
    return rows.map(toPlan);
  }
}

const DOSE_SELECT = [
  "dose_occurrences.id",
  "dose_occurrences.family_id",
  "dose_occurrences.member_id",
  "dose_occurrences.plan_id",
  "dose_occurrences.scheduled_at",
  "dose_occurrences.status",
  "dose_occurrences.acted_at",
  "dose_occurrences.acted_by_user_id",
  "dose_occurrences.note",
  "dose_occurrences.generation_version",
  "dose_occurrences.created_at",
  "medication_plans.name as medication_name",
  "medication_plans.dosage as dosage",
] as const;

function toCursorPage<Row extends { created_at: Date; id: string }, T>(rows: Row[], limit: number, map: (row: Row) => T): CursorPage<T> {
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id }) : null;
  return { items: page.map(map), nextCursor };
}

export class KyselyDoseOccurrencesRepository implements DoseOccurrencesRepository<Kysely<Database>> {
  async insertMany(trx: Kysely<Database>, records: NewDoseOccurrenceRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    await trx
      .insertInto("dose_occurrences")
      .values(
        records.map((record) => ({
          id: record.id,
          family_id: record.familyId,
          member_id: record.memberId,
          plan_id: record.planId,
          scheduled_at: record.scheduledAt,
          status: "PENDING" as const,
          generation_version: record.generationVersion,
          created_at: record.createdAt,
        })),
      )
      // DM5: idempotente — nunca duplica (plan_id, scheduled_at) é UNIQUE (schema.md §3).
      .onConflict((oc) => oc.columns(["plan_id", "scheduled_at"]).doNothing())
      .execute();
  }

  async listFutureByPlan(trx: Kysely<Database>, planId: string, after: Date): Promise<DoseOccurrence[]> {
    const rows = await trx
      .selectFrom("dose_occurrences")
      .innerJoin("medication_plans", "medication_plans.id", "dose_occurrences.plan_id")
      .select(DOSE_SELECT)
      .where("dose_occurrences.plan_id", "=", planId)
      .where("dose_occurrences.scheduled_at", ">", after)
      .execute();
    return rows.map(toDose);
  }

  async deletePendingNotIn(trx: Kysely<Database>, planId: string, after: Date, keep: Date[]): Promise<void> {
    let query = trx
      .deleteFrom("dose_occurrences")
      .where("plan_id", "=", planId)
      .where("status", "=", "PENDING")
      .where("scheduled_at", ">", after);
    if (keep.length > 0) {
      query = query.where("scheduled_at", "not in", keep);
    }
    await query.execute();
  }

  async deleteAllFuturePending(trx: Kysely<Database>, planId: string, after: Date): Promise<void> {
    await trx.deleteFrom("dose_occurrences").where("plan_id", "=", planId).where("status", "=", "PENDING").where("scheduled_at", ">", after).execute();
  }

  async findById(trx: Kysely<Database>, familyId: string, memberId: string, doseId: string): Promise<DoseOccurrence | null> {
    const row = await trx
      .selectFrom("dose_occurrences")
      .innerJoin("medication_plans", "medication_plans.id", "dose_occurrences.plan_id")
      .select(DOSE_SELECT)
      .where("dose_occurrences.family_id", "=", familyId)
      .where("dose_occurrences.member_id", "=", memberId)
      .where("dose_occurrences.id", "=", doseId)
      .executeTakeFirst();
    return row ? toDose(row) : null;
  }

  async listByMember(trx: Kysely<Database>, familyId: string, memberId: string, filter: DoseListFilter, limit: number, cursor?: string): Promise<CursorPage<DoseOccurrence>> {
    let query = trx
      .selectFrom("dose_occurrences")
      .innerJoin("medication_plans", "medication_plans.id", "dose_occurrences.plan_id")
      .select(DOSE_SELECT)
      .where("dose_occurrences.family_id", "=", familyId)
      .where("dose_occurrences.member_id", "=", memberId);
    if (filter.from) query = query.where("dose_occurrences.scheduled_at", ">=", filter.from);
    if (filter.to) query = query.where("dose_occurrences.scheduled_at", "<=", filter.to);
    if (filter.status) query = query.where("dose_occurrences.status", "=", filter.status);
    if (filter.planId) query = query.where("dose_occurrences.plan_id", "=", filter.planId);
    if (cursor) {
      const decoded = decodeCursor(cursor);
      const after = new Date(decoded.createdAt);
      query = query.where((eb) =>
        eb.or([eb("dose_occurrences.created_at", ">", after), eb.and([eb("dose_occurrences.created_at", "=", after), eb("dose_occurrences.id", ">", decoded.id)])]),
      );
    }
    const rows = await query
      .orderBy("dose_occurrences.created_at", "asc")
      .orderBy("dose_occurrences.id", "asc")
      .limit(limit + 1)
      .execute();
    return toCursorPage(rows, limit, toDose);
  }

  async updateStatus(trx: Kysely<Database>, doseId: string, status: DoseStatus, actedAt: Date | null, actedByUserId: string | null, note: string | null): Promise<DoseOccurrence> {
    await trx
      .updateTable("dose_occurrences")
      .set({ status, acted_at: actedAt, acted_by_user_id: actedByUserId, note, updated_at: sql`now()` })
      .where("id", "=", doseId)
      .execute();
    const row = await trx
      .selectFrom("dose_occurrences")
      .innerJoin("medication_plans", "medication_plans.id", "dose_occurrences.plan_id")
      .select(DOSE_SELECT)
      .where("dose_occurrences.id", "=", doseId)
      .executeTakeFirstOrThrow();
    return toDose(row);
  }

  async listPendingBefore(trx: Kysely<Database>, threshold: Date, limit: number): Promise<DoseOccurrence[]> {
    const rows = await trx
      .selectFrom("dose_occurrences")
      .innerJoin("medication_plans", "medication_plans.id", "dose_occurrences.plan_id")
      .select(DOSE_SELECT)
      .where("dose_occurrences.status", "=", "PENDING")
      .where("dose_occurrences.scheduled_at", "<=", threshold)
      .limit(limit)
      .execute();
    return rows.map(toDose);
  }

  async listReminderCandidates(trx: Kysely<Database>, now: Date, limit: number): Promise<DoseOccurrence[]> {
    const rows = await trx
      .selectFrom("dose_occurrences")
      .innerJoin("medication_plans", "medication_plans.id", "dose_occurrences.plan_id")
      .select(DOSE_SELECT)
      // indexes.md: `(status, scheduled_at) WHERE status IN ('PENDING','UNCONFIRMED')` — mesmo
      // índice do `mark-unconfirmed`, reaproveitado pelo scanner de alertas (M8).
      .where("dose_occurrences.status", "in", ["PENDING", "UNCONFIRMED"])
      .where("dose_occurrences.scheduled_at", "<=", now)
      .orderBy("dose_occurrences.scheduled_at", "asc")
      .limit(limit)
      .execute();
    return rows.map(toDose);
  }

  async adherenceByMember(trx: Kysely<Database>, familyId: string, memberId: string, from: Date, to: Date): Promise<AdherenceItem[]> {
    const rows = await trx
      .selectFrom("dose_occurrences")
      .innerJoin("medication_plans", "medication_plans.id", "dose_occurrences.plan_id")
      .select([
        "dose_occurrences.plan_id",
        "medication_plans.name as medication_name",
        "dose_occurrences.status",
        trx.fn.countAll<string>().as("count"),
      ])
      .where("dose_occurrences.family_id", "=", familyId)
      .where("dose_occurrences.member_id", "=", memberId)
      .where("dose_occurrences.scheduled_at", ">=", from)
      .where("dose_occurrences.scheduled_at", "<=", to)
      .groupBy(["dose_occurrences.plan_id", "medication_plans.name", "dose_occurrences.status"])
      .execute();

    const byPlan = new Map<string, AdherenceItem>();
    for (const row of rows) {
      let item = byPlan.get(row.plan_id);
      if (!item) {
        item = { planId: row.plan_id, medicationName: row.medication_name, taken: 0, notTaken: 0, unconfirmed: 0, pending: 0 };
        byPlan.set(row.plan_id, item);
      }
      const count = Number(row.count);
      if (row.status === "TAKEN") item.taken = count;
      else if (row.status === "NOT_TAKEN") item.notTaken = count;
      else if (row.status === "UNCONFIRMED") item.unconfirmed = count;
      else item.pending = count;
    }
    return [...byPlan.values()];
  }
}
