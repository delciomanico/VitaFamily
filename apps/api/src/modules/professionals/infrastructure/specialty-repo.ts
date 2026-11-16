// Implementação Kysely/pg da porta `SpecialtyRepository` (catálogo de especialidades, BR-MKT-22). SQL parametrizado; sem regras de negócio aqui.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { NewSpecialtyRecord, SpecialtyChanges, SpecialtyListRow, SpecialtyRecord, SpecialtyRepository } from "../application/ports.js";
import "./schema.js";

export class KyselySpecialtyRepository implements SpecialtyRepository<Kysely<Database>> {
  async list(trx: Kysely<Database>, options: { activeOnly: boolean }): Promise<SpecialtyListRow[]> {
    let query = trx
      .selectFrom("specialties as s")
      .leftJoin("professional_specialties as ps", "ps.specialty_id", "s.id")
      .select(["s.id", "s.name", "s.category", "s.active", sql<number>`count(ps.professional_id)::int`.as("professional_count")])
      .groupBy("s.id")
      .orderBy("s.name");
    if (options.activeOnly) {
      query = query.where("s.active", "=", true);
    }
    const rows = await query.execute();
    return rows.map((row) => ({ id: row.id, name: row.name, category: row.category, active: row.active, professionalCount: row.professional_count }));
  }

  async findByIdForUpdate(trx: Kysely<Database>, id: string): Promise<SpecialtyRecord | null> {
    const row = await trx.selectFrom("specialties").select(["id", "name", "category", "active"]).where("id", "=", id).forUpdate().executeTakeFirst();
    return row ?? null;
  }

  async insert(trx: Kysely<Database>, record: NewSpecialtyRecord): Promise<SpecialtyRecord | null> {
    // `ON CONFLICT DO NOTHING` sobre o índice `specialties_name_lower_uq` (lower(name)): sem erro 23505 que aborte a transação.
    const row = await trx
      .insertInto("specialties")
      .values({ id: record.id, name: record.name, category: record.category, created_at: record.createdAt, updated_at: record.createdAt })
      .onConflict((oc) => oc.expression(sql`lower(name)`).doNothing())
      .returning(["id", "name", "category", "active"])
      .executeTakeFirst();
    return row ?? null;
  }

  async update(trx: Kysely<Database>, id: string, changes: SpecialtyChanges): Promise<void> {
    await trx
      .updateTable("specialties")
      .set({
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.category !== undefined ? { category: changes.category } : {}),
        ...(changes.active !== undefined ? { active: changes.active } : {}),
        updated_at: changes.updatedAt,
      })
      .where("id", "=", id)
      .execute();
  }

  async countProfessionals(trx: Kysely<Database>, id: string): Promise<number> {
    const row = await trx
      .selectFrom("professional_specialties")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("specialty_id", "=", id)
      .executeTakeFirstOrThrow();
    return row.n;
  }

  async existsByNameLower(trx: Kysely<Database>, name: string, excludeId?: string): Promise<boolean> {
    let query = trx.selectFrom("specialties").select("id").where(sql`lower(name)`, "=", sql`lower(${name})`);
    if (excludeId !== undefined) {
      query = query.where("id", "<>", excludeId);
    }
    const row = await query.executeTakeFirst();
    return row !== undefined;
  }
}
