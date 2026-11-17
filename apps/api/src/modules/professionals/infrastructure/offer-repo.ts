// Implementação Kysely/pg de `OfferRepository` (BR-MKT-24). Todas as consultas levam `professional_id`.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { NewOfferRecord, OfferRecord, OfferRepository } from "../application/ports.js";
import type { OfferMethod, OfferPatchFields } from "../domain/offer.js";
import "./schema.js";

interface OfferRow {
  id: string;
  professional_id: string;
  specialty_id: string;
  method: OfferMethod;
  duration_minutes: number;
  price_kz: number;
  note: string | null;
  active: boolean;
}

function toRecord(r: OfferRow): OfferRecord {
  return { id: r.id, professionalId: r.professional_id, specialtyId: r.specialty_id, method: r.method, durationMinutes: r.duration_minutes, priceKz: r.price_kz, note: r.note, active: r.active };
}

export class KyselyOfferRepository implements OfferRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewOfferRecord): Promise<OfferRecord | null> {
    const row = await trx
      .insertInto("professional_offers")
      .values({
        id: record.id,
        professional_id: record.professionalId,
        specialty_id: record.specialtyId,
        method: record.method,
        duration_minutes: record.durationMinutes,
        price_kz: record.priceKz,
        note: record.note,
        created_at: record.createdAt,
      })
      .onConflict((oc) => oc.doNothing())
      .returning(["id", "professional_id", "specialty_id", "method", "duration_minutes", "price_kz", "note", "active"])
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async list(trx: Kysely<Database>, professionalId: string, options: { active?: boolean }): Promise<OfferRecord[]> {
    let query = trx
      .selectFrom("professional_offers as o")
      .innerJoin("specialties as s", "s.id", "o.specialty_id")
      .select(["o.id", "o.professional_id", "o.specialty_id", "o.method", "o.duration_minutes", "o.price_kz", "o.note", "o.active"])
      .where("o.professional_id", "=", professionalId);
    if (options.active !== undefined) query = query.where("o.active", "=", options.active);
    const rows = await query.orderBy("s.name").orderBy("o.method").orderBy("o.duration_minutes").orderBy("o.id").execute();
    return rows.map(toRecord);
  }

  async findOwned(trx: Kysely<Database>, professionalId: string, offerId: string, options: { forUpdate?: boolean } = {}): Promise<OfferRecord | null> {
    let query = trx.selectFrom("professional_offers").select(["id", "professional_id", "specialty_id", "method", "duration_minutes", "price_kz", "note", "active"]).where("id", "=", offerId).where("professional_id", "=", professionalId);
    if (options.forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async update(trx: Kysely<Database>, offerId: string, changes: OfferPatchFields, now: Date): Promise<void> {
    await trx
      .updateTable("professional_offers")
      .set({
        ...(changes.priceKz !== undefined ? { price_kz: changes.priceKz } : {}),
        ...(changes.note !== undefined ? { note: changes.note } : {}),
        ...(changes.active !== undefined ? { active: changes.active } : {}),
        updated_at: now,
      })
      .where("id", "=", offerId)
      .execute();
  }

  async countActive(trx: Kysely<Database>, professionalId: string): Promise<number> {
    const row = await trx.selectFrom("professional_offers").select(sql<number>`count(*)::int`.as("n")).where("professional_id", "=", professionalId).where("active", "=", true).executeTakeFirstOrThrow();
    return row.n;
  }

  async existsActiveDuplicate(trx: Kysely<Database>, professionalId: string, key: { specialtyId: string; method: OfferMethod; durationMinutes: number }, excludeId?: string): Promise<boolean> {
    let query = trx
      .selectFrom("professional_offers")
      .select("id")
      .where("professional_id", "=", professionalId)
      .where("specialty_id", "=", key.specialtyId)
      .where("method", "=", key.method)
      .where("duration_minutes", "=", key.durationMinutes)
      .where("active", "=", true);
    if (excludeId) query = query.where("id", "!=", excludeId);
    return (await query.executeTakeFirst()) !== undefined;
  }
}
