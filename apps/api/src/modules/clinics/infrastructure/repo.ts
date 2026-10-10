// Implementação Kysely/pg das portas de `clinics` (application/ports.ts).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { Clinic, ClinicStatus } from "../domain/clinic.js";
import type { ClinicChanges, ClinicListFilter, ClinicsRepository, NewClinicRecord } from "../application/ports.js";
import "./schema.js";

interface ClinicRow {
  id: string;
  type: "PARTNER" | "PRIVATE";
  family_id: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  status: ClinicStatus;
  created_by: string | null;
  created_at: Date;
}

function toClinic(row: ClinicRow): Clinic {
  const clinic: Clinic = {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.family_id !== null) clinic.familyId = row.family_id;
  if (row.address !== null) clinic.address = row.address;
  if (row.phone !== null) clinic.phone = row.phone;
  if (row.email !== null) clinic.email = row.email;
  if (row.created_by !== null) clinic.createdBy = row.created_by;
  return clinic;
}

const CLINIC_COLUMNS = ["id", "type", "family_id", "name", "address", "phone", "email", "status", "created_by", "created_at"] as const;

export class KyselyClinicsRepository implements ClinicsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewClinicRecord): Promise<Clinic> {
    const row = await trx
      .insertInto("clinics")
      .values({
        id: record.id,
        type: record.type,
        family_id: record.familyId ?? null,
        name: record.name,
        address: record.address ?? null,
        phone: record.phone ?? null,
        email: record.email ?? null,
        status: "ACTIVE",
        created_by: record.createdBy ?? null,
        created_at: record.createdAt,
      })
      .returning(CLINIC_COLUMNS)
      .executeTakeFirstOrThrow();
    return toClinic(row);
  }

  async findById(trx: Kysely<Database>, clinicId: string): Promise<Clinic | null> {
    const row = await trx.selectFrom("clinics").select(CLINIC_COLUMNS).where("id", "=", clinicId).executeTakeFirst();
    return row ? toClinic(row) : null;
  }

  async listVisibleToFamily(trx: Kysely<Database>, familyId: string, filter: ClinicListFilter): Promise<Clinic[]> {
    let query = trx
      .selectFrom("clinics")
      .select(CLINIC_COLUMNS)
      .where((eb) => eb.or([eb("type", "=", "PARTNER"), eb("family_id", "=", familyId)]));
    if (filter.status) {
      query = query.where("status", "=", filter.status);
    }
    const rows = await query.orderBy("name", "asc").execute();
    return rows.map(toClinic);
  }

  async listPartners(trx: Kysely<Database>, filter: ClinicListFilter): Promise<Clinic[]> {
    let query = trx.selectFrom("clinics").select(CLINIC_COLUMNS).where("type", "=", "PARTNER");
    if (filter.status) {
      query = query.where("status", "=", filter.status);
    }
    const rows = await query.orderBy("name", "asc").execute();
    return rows.map(toClinic);
  }

  async countPrivateByFamily(trx: Kysely<Database>, familyId: string): Promise<number> {
    const row = await trx
      .selectFrom("clinics")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("type", "=", "PRIVATE")
      .where("family_id", "=", familyId)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async update(trx: Kysely<Database>, clinicId: string, changes: ClinicChanges): Promise<Clinic> {
    const row = await trx
      .updateTable("clinics")
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.address !== undefined ? { address: changes.address } : {}),
        ...(changes.phone !== undefined ? { phone: changes.phone } : {}),
        ...(changes.email !== undefined ? { email: changes.email } : {}),
        updated_at: sql`now()`,
      })
      .where("id", "=", clinicId)
      .returning(CLINIC_COLUMNS)
      .executeTakeFirstOrThrow();
    return toClinic(row);
  }

  async updateStatus(trx: Kysely<Database>, clinicId: string, status: ClinicStatus): Promise<Clinic> {
    const row = await trx
      .updateTable("clinics")
      .set({ status, updated_at: sql`now()` })
      .where("id", "=", clinicId)
      .returning(CLINIC_COLUMNS)
      .executeTakeFirstOrThrow();
    return toClinic(row);
  }

  async delete(trx: Kysely<Database>, clinicId: string): Promise<void> {
    await trx.deleteFrom("clinics").where("id", "=", clinicId).execute();
  }
}
