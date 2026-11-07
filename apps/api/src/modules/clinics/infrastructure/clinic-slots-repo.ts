// Implementação Kysely/pg da porta `ClinicSlotsRepository` (application/ports.ts, Fase C).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { ClinicSlotDuplicateCheck, ClinicSlotListFilter, ClinicSlotsRepository, NewClinicSlotRecord } from "../application/ports.js";
import type { ClinicSlot, ClinicSlotKind } from "../domain/clinic-slot.js";
import "./clinic-slots-schema.js";

interface ClinicSlotRow {
  id: string;
  clinic_id: string;
  kind: ClinicSlotKind;
  specialty: string;
  professional_name: string | null;
  starts_at: Date;
  duration_minutes: number;
  capacity: number;
  professional_id: string | null;
  service_type_id: string | null;
  schedule_rule_id: string | null;
  created_at: Date;
}

function toClinicSlot(row: ClinicSlotRow): ClinicSlot {
  const slot: ClinicSlot = {
    id: row.id,
    clinicId: row.clinic_id,
    kind: row.kind,
    specialty: row.specialty,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    capacity: row.capacity,
    createdAt: row.created_at,
  };
  if (row.professional_name !== null) {
    slot.professionalName = row.professional_name;
  }
  if (row.professional_id !== null) slot.professionalId = row.professional_id;
  if (row.service_type_id !== null) slot.serviceTypeId = row.service_type_id;
  if (row.schedule_rule_id !== null) slot.scheduleRuleId = row.schedule_rule_id;
  return slot;
}

const CLINIC_SLOT_COLUMNS = ["id", "clinic_id", "kind", "specialty", "professional_name", "starts_at", "duration_minutes", "capacity", "professional_id", "service_type_id", "schedule_rule_id", "created_at"] as const;

/** `ends_at` é mantida aqui (não é coluna gerada, schema.md §3a): `starts_at + duração`. */
function toInsertValues(record: NewClinicSlotRecord) {
  return {
    id: record.id,
    clinic_id: record.clinicId,
    kind: record.kind,
    specialty: record.specialty,
    professional_name: record.professionalName ?? null,
    starts_at: record.startsAt,
    duration_minutes: record.durationMinutes,
    ends_at: new Date(record.startsAt.getTime() + record.durationMinutes * 60_000),
    capacity: record.capacity,
    professional_id: record.professionalId ?? null,
    service_type_id: record.serviceTypeId ?? null,
    schedule_rule_id: record.scheduleRuleId ?? null,
    created_at: record.createdAt,
  };
}

export class KyselyClinicSlotsRepository implements ClinicSlotsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewClinicSlotRecord): Promise<ClinicSlot> {
    const row = await trx
      .insertInto("clinic_slots")
      .values(toInsertValues(record))
      .returning(CLINIC_SLOT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toClinicSlot(row);
  }

  async findById(trx: Kysely<Database>, slotId: string): Promise<ClinicSlot | null> {
    const row = await trx.selectFrom("clinic_slots").select(CLINIC_SLOT_COLUMNS).where("id", "=", slotId).executeTakeFirst();
    return row ? toClinicSlot(row) : null;
  }

  async listByClinic(trx: Kysely<Database>, clinicId: string, filter: ClinicSlotListFilter): Promise<ClinicSlot[]> {
    let query = trx.selectFrom("clinic_slots").select(CLINIC_SLOT_COLUMNS).where("clinic_id", "=", clinicId);
    if (filter.from) {
      query = query.where("starts_at", ">=", filter.from);
    }
    if (filter.to) {
      query = query.where("starts_at", "<=", filter.to);
    }
    if (filter.kind) {
      query = query.where("kind", "=", filter.kind);
    }
    if (filter.specialty) {
      query = query.where("specialty", "=", filter.specialty);
    }
    const rows = await query.orderBy("starts_at", "asc").execute();
    return rows.map(toClinicSlot);
  }

  async existsDuplicate(trx: Kysely<Database>, clinicId: string, slot: ClinicSlotDuplicateCheck): Promise<boolean> {
    let query = trx
      .selectFrom("clinic_slots")
      .select("id")
      .where("clinic_id", "=", clinicId)
      .where("kind", "=", slot.kind)
      .where("starts_at", "=", slot.startsAt)
      .where("specialty", "=", slot.specialty);
    query = slot.professionalName ? query.where("professional_name", "=", slot.professionalName) : query.where("professional_name", "is", null);
    const row = await query.executeTakeFirst();
    return row !== undefined;
  }

  async lockById(trx: Kysely<Database>, slotId: string): Promise<ClinicSlot | null> {
    const row = await trx.selectFrom("clinic_slots").select(CLINIC_SLOT_COLUMNS).where("id", "=", slotId).forUpdate().executeTakeFirst();
    return row ? toClinicSlot(row) : null;
  }

  async updateCapacity(trx: Kysely<Database>, slotId: string, capacity: number): Promise<ClinicSlot> {
    const row = await trx.updateTable("clinic_slots").set({ capacity, updated_at: sql`now()` }).where("id", "=", slotId).returning(CLINIC_SLOT_COLUMNS).executeTakeFirstOrThrow();
    return toClinicSlot(row);
  }

  async delete(trx: Kysely<Database>, slotId: string): Promise<void> {
    await trx.deleteFrom("clinic_slots").where("id", "=", slotId).execute();
  }

  async insertManyIgnoringConflicts(trx: Kysely<Database>, records: NewClinicSlotRecord[]): Promise<ClinicSlot[]> {
    if (records.length === 0) {
      return [];
    }
    const rows = await trx
      .insertInto("clinic_slots")
      .values(records.map(toInsertValues))
      .onConflict((oc) => oc.doNothing())
      .returning(CLINIC_SLOT_COLUMNS)
      .execute();
    return rows.map(toClinicSlot);
  }

  async listByProfessional(trx: Kysely<Database>, professionalId: string, filter: { endsAfter?: Date; startsBefore?: Date }): Promise<ClinicSlot[]> {
    let query = trx.selectFrom("clinic_slots").select(CLINIC_SLOT_COLUMNS).where("professional_id", "=", professionalId);
    if (filter.endsAfter) query = query.where("ends_at", ">", filter.endsAfter);
    if (filter.startsBefore) query = query.where("starts_at", "<", filter.startsBefore);
    const rows = await query.orderBy("starts_at", "asc").execute();
    return rows.map(toClinicSlot);
  }

  async listFutureByRule(trx: Kysely<Database>, scheduleRuleId: string, after: Date): Promise<ClinicSlot[]> {
    const rows = await trx.selectFrom("clinic_slots").select(CLINIC_SLOT_COLUMNS).where("schedule_rule_id", "=", scheduleRuleId).where("starts_at", ">", after).orderBy("starts_at", "asc").execute();
    return rows.map(toClinicSlot);
  }

  async lockMany(trx: Kysely<Database>, slotIds: string[]): Promise<ClinicSlot[]> {
    if (slotIds.length === 0) {
      return [];
    }
    const rows = await trx.selectFrom("clinic_slots").select(CLINIC_SLOT_COLUMNS).where("id", "in", slotIds).orderBy("id").forUpdate().execute();
    return rows.map(toClinicSlot);
  }

  async deleteMany(trx: Kysely<Database>, slotIds: string[]): Promise<void> {
    if (slotIds.length === 0) {
      return;
    }
    await trx.deleteFrom("clinic_slots").where("id", "in", slotIds).execute();
  }
}
