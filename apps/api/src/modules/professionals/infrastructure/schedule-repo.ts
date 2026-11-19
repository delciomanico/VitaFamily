// Implementações Kysely/pg de `ScheduleRuleRepository`, `TimeOffRepository` e `SlotRepository` (BR-MKT-25). Toda a consulta leva `professional_id`.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type {
  ScheduleRuleChanges,
  ScheduleRuleRecord,
  ScheduleRuleRepository,
  ScheduleRuleWithOffer,
  SlotRecord,
  SlotRepository,
  TimeOffRecord,
  TimeOffRepository,
} from "../application/ports.js";
import "./schema.js";

interface RuleRow {
  id: string;
  professional_id: string;
  offer_id: string;
  weekdays: number[];
  start_time: string;
  end_time: string;
  valid_from: string | null;
  valid_until: string | null;
  active: boolean;
}

/** `time` do pg vem como `HH:mm:ss`; a API trabalha com `HH:mm`. */
const hhmm = (value: string): string => value.slice(0, 5);

function toRule(r: RuleRow): ScheduleRuleRecord {
  return { id: r.id, professionalId: r.professional_id, offerId: r.offer_id, weekdays: [...r.weekdays].sort((a, b) => a - b), startTime: hhmm(r.start_time), endTime: hhmm(r.end_time), validFrom: r.valid_from, validUntil: r.valid_until, active: r.active };
}

const RULE_COLUMNS = ["id", "professional_id", "offer_id", "weekdays", "start_time", "end_time", "valid_from", "valid_until", "active"] as const;

export class KyselyScheduleRuleRepository implements ScheduleRuleRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: ScheduleRuleRecord & { createdAt: Date }): Promise<ScheduleRuleRecord> {
    const row = await trx
      .insertInto("professional_schedule_rules")
      .values({
        id: record.id,
        professional_id: record.professionalId,
        offer_id: record.offerId,
        weekdays: record.weekdays,
        start_time: record.startTime,
        end_time: record.endTime,
        valid_from: record.validFrom,
        valid_until: record.validUntil,
        active: record.active,
        created_at: record.createdAt,
      })
      .returning(RULE_COLUMNS)
      .executeTakeFirstOrThrow();
    return toRule(row);
  }

  async list(trx: Kysely<Database>, professionalId: string, filter: { offerId?: string; active?: boolean }): Promise<ScheduleRuleRecord[]> {
    let query = trx.selectFrom("professional_schedule_rules").select(RULE_COLUMNS).where("professional_id", "=", professionalId);
    if (filter.offerId) query = query.where("offer_id", "=", filter.offerId);
    if (filter.active !== undefined) query = query.where("active", "=", filter.active);
    return (await query.orderBy("created_at").orderBy("id").execute()).map(toRule);
  }

  async findOwned(trx: Kysely<Database>, professionalId: string, ruleId: string, options: { forUpdate?: boolean } = {}): Promise<ScheduleRuleRecord | null> {
    let query = trx.selectFrom("professional_schedule_rules").select(RULE_COLUMNS).where("id", "=", ruleId).where("professional_id", "=", professionalId);
    if (options.forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toRule(row) : null;
  }

  async update(trx: Kysely<Database>, ruleId: string, changes: ScheduleRuleChanges, now: Date): Promise<void> {
    await trx
      .updateTable("professional_schedule_rules")
      .set({
        ...(changes.weekdays !== undefined ? { weekdays: changes.weekdays } : {}),
        ...(changes.startTime !== undefined ? { start_time: changes.startTime } : {}),
        ...(changes.endTime !== undefined ? { end_time: changes.endTime } : {}),
        ...(changes.validFrom !== undefined ? { valid_from: changes.validFrom } : {}),
        ...(changes.validUntil !== undefined ? { valid_until: changes.validUntil } : {}),
        ...(changes.active !== undefined ? { active: changes.active } : {}),
        updated_at: now,
      })
      .where("id", "=", ruleId)
      .execute();
  }

  async countActive(trx: Kysely<Database>, professionalId: string): Promise<number> {
    const row = await trx.selectFrom("professional_schedule_rules").select(sql<number>`count(*)::int`.as("n")).where("professional_id", "=", professionalId).where("active", "=", true).executeTakeFirstOrThrow();
    return row.n;
  }

  async listActive(trx: Kysely<Database>, professionalId: string, excludeRuleId?: string): Promise<ScheduleRuleRecord[]> {
    let query = trx.selectFrom("professional_schedule_rules").select(RULE_COLUMNS).where("professional_id", "=", professionalId).where("active", "=", true);
    if (excludeRuleId) query = query.where("id", "!=", excludeRuleId);
    return (await query.execute()).map(toRule);
  }

  async listWithOffer(trx: Kysely<Database>, professionalId: string, filter: { offerId?: string; ruleId?: string }): Promise<ScheduleRuleWithOffer[]> {
    let query = trx
      .selectFrom("professional_schedule_rules as r")
      .innerJoin("professional_offers as o", (join) => join.onRef("o.id", "=", "r.offer_id").onRef("o.professional_id", "=", "r.professional_id"))
      .select(["r.id", "r.professional_id", "r.offer_id", "r.weekdays", "r.start_time", "r.end_time", "r.valid_from", "r.valid_until", "r.active", "o.active as offer_active", "o.duration_minutes as offer_duration"])
      .where("r.professional_id", "=", professionalId);
    if (filter.offerId) query = query.where("r.offer_id", "=", filter.offerId);
    if (filter.ruleId) query = query.where("r.id", "=", filter.ruleId);
    const rows = await query.orderBy("r.created_at").orderBy("r.id").execute();
    return rows.map((r) => ({ ...toRule(r), offerActive: r.offer_active, offerDurationMinutes: r.offer_duration }));
  }

  async listApprovedProfessionalIdsWithActiveRules(trx: Kysely<Database>): Promise<string[]> {
    const rows = await trx
      .selectFrom("professionals as p")
      .select("p.id")
      .where("p.validation_status", "=", "APPROVED")
      .where(sql<boolean>`EXISTS (SELECT 1 FROM professional_schedule_rules r WHERE r.professional_id = p.id AND r.active)`)
      .orderBy("p.id")
      .execute();
    return rows.map((r) => r.id);
  }
}

export class KyselyTimeOffRepository implements TimeOffRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: TimeOffRecord & { createdAt: Date }): Promise<TimeOffRecord> {
    const row = await trx
      .insertInto("professional_time_off")
      .values({ id: record.id, professional_id: record.professionalId, starts_at: record.startsAt, ends_at: record.endsAt, reason: record.reason, created_at: record.createdAt })
      .returning(["id", "professional_id", "starts_at", "ends_at", "reason"])
      .executeTakeFirstOrThrow();
    return { id: row.id, professionalId: row.professional_id, startsAt: row.starts_at, endsAt: row.ends_at, reason: row.reason };
  }

  async list(trx: Kysely<Database>, professionalId: string, filter: { from?: Date; to?: Date; endsAfter?: Date }): Promise<TimeOffRecord[]> {
    let query = trx.selectFrom("professional_time_off").select(["id", "professional_id", "starts_at", "ends_at", "reason"]).where("professional_id", "=", professionalId);
    if (filter.endsAfter) query = query.where("ends_at", ">", filter.endsAfter);
    if (filter.from) query = query.where("ends_at", ">", filter.from);
    if (filter.to) query = query.where("starts_at", "<", filter.to);
    const rows = await query.orderBy("starts_at").orderBy("id").execute();
    return rows.map((row) => ({ id: row.id, professionalId: row.professional_id, startsAt: row.starts_at, endsAt: row.ends_at, reason: row.reason }));
  }

  async findOwned(trx: Kysely<Database>, professionalId: string, id: string): Promise<TimeOffRecord | null> {
    const row = await trx.selectFrom("professional_time_off").select(["id", "professional_id", "starts_at", "ends_at", "reason"]).where("id", "=", id).where("professional_id", "=", professionalId).executeTakeFirst();
    return row ? { id: row.id, professionalId: row.professional_id, startsAt: row.starts_at, endsAt: row.ends_at, reason: row.reason } : null;
  }

  async delete(trx: Kysely<Database>, professionalId: string, id: string): Promise<void> {
    await trx.deleteFrom("professional_time_off").where("id", "=", id).where("professional_id", "=", professionalId).execute();
  }
}

export class KyselySlotRepository implements SlotRepository<Kysely<Database>> {
  async listInRange(trx: Kysely<Database>, professionalId: string, from: Date, to: Date): Promise<SlotRecord[]> {
    const rows = await trx.selectFrom("professional_slots").select(["id", "offer_id", "rule_id", "starts_at", "ends_at", "booking_id"]).where("professional_id", "=", professionalId).where("starts_at", ">=", from).where("starts_at", "<", to).orderBy("starts_at").orderBy("id").execute();
    return rows.map((r) => ({ id: r.id, offerId: r.offer_id, ruleId: r.rule_id, startsAt: r.starts_at, endsAt: r.ends_at, bookingId: r.booking_id }));
  }

  async listFuture(trx: Kysely<Database>, professionalId: string, after: Date): Promise<SlotRecord[]> {
    const rows = await trx.selectFrom("professional_slots").select(["id", "offer_id", "rule_id", "starts_at", "ends_at", "booking_id"]).where("professional_id", "=", professionalId).where("ends_at", ">", after).orderBy("starts_at").execute();
    return rows.map((r) => ({ id: r.id, offerId: r.offer_id, ruleId: r.rule_id, startsAt: r.starts_at, endsAt: r.ends_at, bookingId: r.booking_id }));
  }

  async insertMany(trx: Kysely<Database>, professionalId: string, slots: { id: string; offerId: string; ruleId: string; startsAt: Date; endsAt: Date; createdAt: Date }[]): Promise<number> {
    if (slots.length === 0) return 0;
    const rows = await trx
      .insertInto("professional_slots")
      .values(slots.map((s) => ({ id: s.id, professional_id: professionalId, offer_id: s.offerId, rule_id: s.ruleId, starts_at: s.startsAt, ends_at: s.endsAt, created_at: s.createdAt })))
      .onConflict((oc) => oc.doNothing())
      .returning("id")
      .execute();
    return rows.length;
  }

  async deleteByIds(trx: Kysely<Database>, professionalId: string, ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await trx.deleteFrom("professional_slots").where("professional_id", "=", professionalId).where("id", "in", ids).where("booking_id", "is", null).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async deleteIntersecting(trx: Kysely<Database>, professionalId: string, from: Date, to: Date): Promise<number> {
    const result = await trx.deleteFrom("professional_slots").where("professional_id", "=", professionalId).where("starts_at", "<", to).where("ends_at", ">", from).where("booking_id", "is", null).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async countBookedIntersecting(trx: Kysely<Database>, professionalId: string, from: Date, to: Date, now: Date): Promise<number> {
    const row = await trx
      .selectFrom("professional_slots")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("professional_id", "=", professionalId)
      .where("booking_id", "is not", null)
      .where("starts_at", ">", now)
      .where("starts_at", "<", to)
      .where("ends_at", ">", from)
      .executeTakeFirstOrThrow();
    return row.n;
  }
}
