// Implementação Kysely/pg da porta `ClinicSlotsRepository` (application/ports.ts, Fase C).
import type { Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { ClinicSlotDuplicateCheck, ClinicSlotListFilter, ClinicSlotsRepository, NewClinicSlotRecord } from "../application/ports.js";
import type { ClinicSlot } from "../domain/clinic-slot.js";
import "./clinic-slots-schema.js";

interface ClinicSlotRow {
  id: string;
  clinic_id: string;
  specialty: string;
  professional_name: string | null;
  starts_at: Date;
  duration_minutes: number;
  created_at: Date;
}

function toClinicSlot(row: ClinicSlotRow): ClinicSlot {
  const slot: ClinicSlot = {
    id: row.id,
    clinicId: row.clinic_id,
    specialty: row.specialty,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    createdAt: row.created_at,
  };
  if (row.professional_name !== null) {
    slot.professionalName = row.professional_name;
  }
  return slot;
}

const CLINIC_SLOT_COLUMNS = ["id", "clinic_id", "specialty", "professional_name", "starts_at", "duration_minutes", "created_at"] as const;

export class KyselyClinicSlotsRepository implements ClinicSlotsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewClinicSlotRecord): Promise<ClinicSlot> {
    const row = await trx
      .insertInto("clinic_slots")
      .values({
        id: record.id,
        clinic_id: record.clinicId,
        specialty: record.specialty,
        professional_name: record.professionalName ?? null,
        starts_at: record.startsAt,
        duration_minutes: record.durationMinutes,
        created_at: record.createdAt,
      })
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
      .where("starts_at", "=", slot.startsAt)
      .where("specialty", "=", slot.specialty);
    query = slot.professionalName ? query.where("professional_name", "=", slot.professionalName) : query.where("professional_name", "is", null);
    const row = await query.executeTakeFirst();
    return row !== undefined;
  }

  async delete(trx: Kysely<Database>, slotId: string): Promise<void> {
    await trx.deleteFrom("clinic_slots").where("id", "=", slotId).execute();
  }
}
