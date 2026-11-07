// Implementação Kysely/pg das portas de catálogo, regras e bloqueios (application/ports.ts, M14 a1/a2).
// Toda leitura/escrita por id exige `clinicId` (isolamento por clínica, sem enumeração).
import { sql, type Kysely } from "kysely";
import { ConflictError } from "../../../platform/errors/index.js";
import type { Database } from "../../../platform/db/index.js";
import type {
  ClinicCatalogRepository,
  ClinicProfessionalChanges,
  ClinicScheduleRuleChanges,
  ClinicScheduleRulesRepository,
  ClinicServiceTypeChanges,
  ClinicTimeOffRepository,
  NewClinicProfessionalRecord,
  NewClinicScheduleRuleRecord,
  NewClinicServiceTypeRecord,
  NewClinicTimeOffRecord,
} from "../application/ports.js";
import type { ClinicProfessional, ClinicServiceType } from "../domain/clinic-catalog.js";
import type { ClinicScheduleRule, ClinicTimeOff } from "../domain/clinic-schedule.js";
import type { ClinicSlotKind } from "../domain/clinic-slot.js";
import "./clinic-catalog-schema.js";
import "./schema.js";

const PG_UNIQUE_VIOLATION = "23505";

/** Nome duplicado entre ativos (UNIQUE parcial, BR-CLN-11) => `CONFLICT`. */
async function mapUnique<T>(action: () => Promise<T>, detail: string): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (typeof error === "object" && error !== null && (error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
      throw new ConflictError({ detail });
    }
    throw error;
  }
}

const PROFESSIONAL_COLUMNS = ["id", "clinic_id", "name", "specialty", "active"] as const;
const SERVICE_COLUMNS = ["id", "clinic_id", "name", "kind", "duration_minutes", "price_minor", "active"] as const;

function toProfessional(row: { id: string; clinic_id: string; name: string; specialty: string | null; active: boolean }): ClinicProfessional {
  return { id: row.id, clinicId: row.clinic_id, name: row.name, specialty: row.specialty, active: row.active };
}

function toService(row: { id: string; clinic_id: string; name: string; kind: ClinicSlotKind; duration_minutes: number; price_minor: string | null; active: boolean }): ClinicServiceType {
  return { id: row.id, clinicId: row.clinic_id, name: row.name, kind: row.kind, durationMinutes: row.duration_minutes, priceMinor: row.price_minor === null ? null : Number(row.price_minor), active: row.active };
}

export class KyselyClinicCatalogRepository implements ClinicCatalogRepository<Kysely<Database>> {
  async lockClinic(trx: Kysely<Database>, clinicId: string): Promise<void> {
    await trx.selectFrom("clinics").select("id").where("id", "=", clinicId).forUpdate().executeTakeFirst();
  }

  async getCurrency(trx: Kysely<Database>, clinicId: string): Promise<string> {
    const row = await trx.selectFrom("clinics").select("currency").where("id", "=", clinicId).executeTakeFirst();
    return row?.currency ?? "AOA";
  }

  async insertProfessional(trx: Kysely<Database>, record: NewClinicProfessionalRecord): Promise<ClinicProfessional> {
    const row = await mapUnique(
      () =>
        trx
          .insertInto("clinic_professionals")
          .values({ id: record.id, clinic_id: record.clinicId, name: record.name, specialty: record.specialty, created_at: record.createdAt })
          .returning(PROFESSIONAL_COLUMNS)
          .executeTakeFirstOrThrow(),
      "Já existe um profissional ativo com esse nome.",
    );
    return toProfessional(row);
  }

  async findProfessional(trx: Kysely<Database>, clinicId: string, professionalId: string): Promise<ClinicProfessional | null> {
    const row = await trx.selectFrom("clinic_professionals").select(PROFESSIONAL_COLUMNS).where("clinic_id", "=", clinicId).where("id", "=", professionalId).executeTakeFirst();
    return row ? toProfessional(row) : null;
  }

  async lockProfessional(trx: Kysely<Database>, clinicId: string, professionalId: string): Promise<ClinicProfessional | null> {
    const row = await trx.selectFrom("clinic_professionals").select(PROFESSIONAL_COLUMNS).where("clinic_id", "=", clinicId).where("id", "=", professionalId).forUpdate().executeTakeFirst();
    return row ? toProfessional(row) : null;
  }

  async listProfessionals(trx: Kysely<Database>, clinicId: string, filter: { active?: boolean }): Promise<ClinicProfessional[]> {
    let query = trx.selectFrom("clinic_professionals").select(PROFESSIONAL_COLUMNS).where("clinic_id", "=", clinicId);
    if (filter.active !== undefined) query = query.where("active", "=", filter.active);
    const rows = await query.orderBy(sql`lower(name)`).orderBy("id").execute();
    return rows.map(toProfessional);
  }

  async countProfessionals(trx: Kysely<Database>, clinicId: string): Promise<number> {
    const row = await trx.selectFrom("clinic_professionals").select(sql<string>`count(*)`.as("total")).where("clinic_id", "=", clinicId).executeTakeFirstOrThrow();
    return Number(row.total);
  }

  async updateProfessional(trx: Kysely<Database>, professionalId: string, changes: ClinicProfessionalChanges): Promise<ClinicProfessional> {
    const row = await mapUnique(
      () =>
        trx
          .updateTable("clinic_professionals")
          .set({
            ...(changes.name !== undefined ? { name: changes.name } : {}),
            ...(changes.specialty !== undefined ? { specialty: changes.specialty } : {}),
            ...(changes.active !== undefined ? { active: changes.active } : {}),
            updated_at: sql`now()`,
          })
          .where("id", "=", professionalId)
          .returning(PROFESSIONAL_COLUMNS)
          .executeTakeFirstOrThrow(),
      "Já existe um profissional ativo com esse nome.",
    );
    return toProfessional(row);
  }

  async insertServiceType(trx: Kysely<Database>, record: NewClinicServiceTypeRecord): Promise<ClinicServiceType> {
    const row = await mapUnique(
      () =>
        trx
          .insertInto("clinic_service_types")
          .values({
            id: record.id,
            clinic_id: record.clinicId,
            name: record.name,
            kind: record.kind,
            duration_minutes: record.durationMinutes,
            price_minor: record.priceMinor,
            created_at: record.createdAt,
          })
          .returning(SERVICE_COLUMNS)
          .executeTakeFirstOrThrow(),
      "Já existe um serviço ativo com esse nome.",
    );
    return toService(row);
  }

  async findServiceType(trx: Kysely<Database>, clinicId: string, serviceTypeId: string): Promise<ClinicServiceType | null> {
    const row = await trx.selectFrom("clinic_service_types").select(SERVICE_COLUMNS).where("clinic_id", "=", clinicId).where("id", "=", serviceTypeId).executeTakeFirst();
    return row ? toService(row) : null;
  }

  async listServiceTypes(trx: Kysely<Database>, clinicId: string, filter: { active?: boolean; kind?: ClinicSlotKind }): Promise<ClinicServiceType[]> {
    let query = trx.selectFrom("clinic_service_types").select(SERVICE_COLUMNS).where("clinic_id", "=", clinicId);
    if (filter.active !== undefined) query = query.where("active", "=", filter.active);
    if (filter.kind) query = query.where("kind", "=", filter.kind);
    const rows = await query.orderBy(sql`lower(name)`).orderBy("id").execute();
    return rows.map(toService);
  }

  async countServiceTypes(trx: Kysely<Database>, clinicId: string): Promise<number> {
    const row = await trx.selectFrom("clinic_service_types").select(sql<string>`count(*)`.as("total")).where("clinic_id", "=", clinicId).executeTakeFirstOrThrow();
    return Number(row.total);
  }

  async updateServiceType(trx: Kysely<Database>, serviceTypeId: string, changes: ClinicServiceTypeChanges): Promise<ClinicServiceType> {
    const row = await mapUnique(
      () =>
        trx
          .updateTable("clinic_service_types")
          .set({
            ...(changes.name !== undefined ? { name: changes.name } : {}),
            ...(changes.durationMinutes !== undefined ? { duration_minutes: changes.durationMinutes } : {}),
            ...(changes.priceMinor !== undefined ? { price_minor: changes.priceMinor } : {}),
            ...(changes.active !== undefined ? { active: changes.active } : {}),
            updated_at: sql`now()`,
          })
          .where("id", "=", serviceTypeId)
          .returning(SERVICE_COLUMNS)
          .executeTakeFirstOrThrow(),
      "Já existe um serviço ativo com esse nome.",
    );
    return toService(row);
  }
}

// `time`/`date` lidos como texto formatado (sem depender dos parsers do `pg`).
const RULE_SELECT = [
  "id",
  "clinic_id",
  "professional_id",
  "service_type_id",
  "weekdays",
  sql<string>`to_char(start_time, 'HH24:MI')`.as("start_time"),
  sql<string>`to_char(end_time, 'HH24:MI')`.as("end_time"),
  sql<string | null>`to_char(valid_from, 'YYYY-MM-DD')`.as("valid_from"),
  sql<string | null>`to_char(valid_until, 'YYYY-MM-DD')`.as("valid_until"),
  "capacity",
  "active",
] as const;

interface RuleRow {
  id: string;
  clinic_id: string;
  professional_id: string;
  service_type_id: string;
  weekdays: number[];
  start_time: string;
  end_time: string;
  valid_from: string | null;
  valid_until: string | null;
  capacity: number;
  active: boolean;
}

function toRule(row: RuleRow): ClinicScheduleRule {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    professionalId: row.professional_id,
    serviceTypeId: row.service_type_id,
    weekdays: [...row.weekdays].map(Number).sort((a, b) => a - b),
    startTime: row.start_time,
    endTime: row.end_time,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    capacity: row.capacity,
    active: row.active,
  };
}

export class KyselyClinicScheduleRulesRepository implements ClinicScheduleRulesRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewClinicScheduleRuleRecord): Promise<ClinicScheduleRule> {
    const row = await trx
      .insertInto("clinic_schedule_rules")
      .values({
        id: record.id,
        clinic_id: record.clinicId,
        professional_id: record.professionalId,
        service_type_id: record.serviceTypeId,
        weekdays: record.weekdays,
        start_time: record.startTime,
        end_time: record.endTime,
        valid_from: record.validFrom,
        valid_until: record.validUntil,
        capacity: record.capacity,
        created_at: record.createdAt,
      })
      .returning(RULE_SELECT)
      .executeTakeFirstOrThrow();
    return toRule(row);
  }

  async findById(trx: Kysely<Database>, clinicId: string, ruleId: string): Promise<ClinicScheduleRule | null> {
    const row = await trx.selectFrom("clinic_schedule_rules").select(RULE_SELECT).where("clinic_id", "=", clinicId).where("id", "=", ruleId).executeTakeFirst();
    return row ? toRule(row) : null;
  }

  async list(trx: Kysely<Database>, clinicId: string, filter: { professionalId?: string; active?: boolean }): Promise<ClinicScheduleRule[]> {
    let query = trx.selectFrom("clinic_schedule_rules").select(RULE_SELECT).where("clinic_id", "=", clinicId);
    if (filter.professionalId) query = query.where("professional_id", "=", filter.professionalId);
    if (filter.active !== undefined) query = query.where("active", "=", filter.active);
    const rows = await query.orderBy("created_at").orderBy("id").execute();
    return rows.map(toRule);
  }

  async count(trx: Kysely<Database>, clinicId: string): Promise<number> {
    const row = await trx.selectFrom("clinic_schedule_rules").select(sql<string>`count(*)`.as("total")).where("clinic_id", "=", clinicId).executeTakeFirstOrThrow();
    return Number(row.total);
  }

  async listActiveByProfessional(trx: Kysely<Database>, professionalId: string): Promise<ClinicScheduleRule[]> {
    const rows = await trx.selectFrom("clinic_schedule_rules").select(RULE_SELECT).where("professional_id", "=", professionalId).where("active", "=", true).orderBy("created_at").orderBy("id").execute();
    return rows.map(toRule);
  }

  async update(trx: Kysely<Database>, ruleId: string, changes: ClinicScheduleRuleChanges): Promise<ClinicScheduleRule> {
    const row = await trx
      .updateTable("clinic_schedule_rules")
      .set({
        ...(changes.weekdays !== undefined ? { weekdays: changes.weekdays } : {}),
        ...(changes.startTime !== undefined ? { start_time: changes.startTime } : {}),
        ...(changes.endTime !== undefined ? { end_time: changes.endTime } : {}),
        ...(changes.validFrom !== undefined ? { valid_from: changes.validFrom } : {}),
        ...(changes.validUntil !== undefined ? { valid_until: changes.validUntil } : {}),
        ...(changes.capacity !== undefined ? { capacity: changes.capacity } : {}),
        ...(changes.active !== undefined ? { active: changes.active } : {}),
        updated_at: sql`now()`,
      })
      .where("id", "=", ruleId)
      .returning(RULE_SELECT)
      .executeTakeFirstOrThrow();
    return toRule(row);
  }

  async listActiveForGeneration(trx: Kysely<Database>): Promise<ClinicScheduleRule[]> {
    const rows = await trx
      .selectFrom("clinic_schedule_rules as r")
      .innerJoin("clinic_professionals as p", (join) => join.onRef("p.id", "=", "r.professional_id").onRef("p.clinic_id", "=", "r.clinic_id"))
      .innerJoin("clinic_service_types as s", (join) => join.onRef("s.id", "=", "r.service_type_id").onRef("s.clinic_id", "=", "r.clinic_id"))
      .select([
        "r.id as id",
        "r.clinic_id as clinic_id",
        "r.professional_id as professional_id",
        "r.service_type_id as service_type_id",
        "r.weekdays as weekdays",
        sql<string>`to_char(r.start_time, 'HH24:MI')`.as("start_time"),
        sql<string>`to_char(r.end_time, 'HH24:MI')`.as("end_time"),
        sql<string | null>`to_char(r.valid_from, 'YYYY-MM-DD')`.as("valid_from"),
        sql<string | null>`to_char(r.valid_until, 'YYYY-MM-DD')`.as("valid_until"),
        "r.capacity as capacity",
        "r.active as active",
      ])
      .where("r.active", "=", true)
      .where("p.active", "=", true)
      .where("s.active", "=", true)
      .orderBy("r.clinic_id")
      .orderBy("r.id")
      .execute();
    return rows.map(toRule);
  }
}

function toTimeOff(row: { id: string; clinic_id: string; professional_id: string; starts_at: Date; ends_at: Date; reason: string | null }): ClinicTimeOff {
  return { id: row.id, clinicId: row.clinic_id, professionalId: row.professional_id, startsAt: row.starts_at, endsAt: row.ends_at, reason: row.reason };
}

const TIME_OFF_COLUMNS = ["id", "clinic_id", "professional_id", "starts_at", "ends_at", "reason"] as const;

export class KyselyClinicTimeOffRepository implements ClinicTimeOffRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewClinicTimeOffRecord): Promise<ClinicTimeOff> {
    const row = await trx
      .insertInto("clinic_time_off")
      .values({
        id: record.id,
        clinic_id: record.clinicId,
        professional_id: record.professionalId,
        starts_at: record.startsAt,
        ends_at: record.endsAt,
        reason: record.reason,
        created_by_clinic_account_id: record.createdByClinicAccountId,
        created_at: record.createdAt,
      })
      .returning(TIME_OFF_COLUMNS)
      .executeTakeFirstOrThrow();
    return toTimeOff(row);
  }

  async findById(trx: Kysely<Database>, clinicId: string, timeOffId: string): Promise<ClinicTimeOff | null> {
    const row = await trx.selectFrom("clinic_time_off").select(TIME_OFF_COLUMNS).where("clinic_id", "=", clinicId).where("id", "=", timeOffId).executeTakeFirst();
    return row ? toTimeOff(row) : null;
  }

  async list(trx: Kysely<Database>, clinicId: string, filter: { professionalId?: string; endsAfter: Date; startsBefore?: Date }): Promise<ClinicTimeOff[]> {
    let query = trx.selectFrom("clinic_time_off").select(TIME_OFF_COLUMNS).where("clinic_id", "=", clinicId).where("ends_at", ">", filter.endsAfter);
    if (filter.professionalId) query = query.where("professional_id", "=", filter.professionalId);
    if (filter.startsBefore) query = query.where("starts_at", "<", filter.startsBefore);
    const rows = await query.orderBy("starts_at").orderBy("id").execute();
    return rows.map(toTimeOff);
  }

  async listOverlapping(trx: Kysely<Database>, professionalId: string, from: Date, to: Date): Promise<ClinicTimeOff[]> {
    const rows = await trx.selectFrom("clinic_time_off").select(TIME_OFF_COLUMNS).where("professional_id", "=", professionalId).where("starts_at", "<", to).where("ends_at", ">", from).execute();
    return rows.map(toTimeOff);
  }

  async delete(trx: Kysely<Database>, timeOffId: string): Promise<void> {
    await trx.deleteFrom("clinic_time_off").where("id", "=", timeOffId).execute();
  }
}
