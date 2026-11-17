// `DirectoryRepository` e `MaintenanceRepository` (Kysely/pg). O leitor público filtra `APPROVED` em CADA consulta (BR-MKT-19).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { ApprovedFactsRow, DirectoryFilter, FactsFilter, SlotStatRecord, DirectoryRepository, MaintenanceRepository, PublicOffer, PublicProfessionalRow, SlotRecord } from "../application/ports.js";
import "./schema.js";

export class KyselyDirectoryRepository implements DirectoryRepository<Kysely<Database>> {
  async findApproved(trx: Kysely<Database>, professionalId: string): Promise<PublicProfessionalRow | null> {
    const row = await trx.selectFrom("professionals").select(["id", "display_name", "bio", "city"]).where("id", "=", professionalId).where("validation_status", "=", "APPROVED").executeTakeFirst();
    return row?.display_name && row.city ? { id: row.id, displayName: row.display_name, bio: row.bio, city: row.city } : null;
  }

  async listApproved(trx: Kysely<Database>, filter: DirectoryFilter): Promise<PublicProfessionalRow[]> {
    let query = trx.selectFrom("professionals as p").select(["p.id", "p.display_name", "p.bio", "p.city"]).where("p.validation_status", "=", "APPROVED");
    if (filter.specialtyId) {
      query = query.where(sql<boolean>`EXISTS (SELECT 1 FROM professional_specialties ps WHERE ps.professional_id = p.id AND ps.specialty_id = ${filter.specialtyId}::uuid)`);
    }
    if (filter.category) {
      query = query.where(sql<boolean>`EXISTS (SELECT 1 FROM professional_specialties ps JOIN specialties s ON s.id = ps.specialty_id WHERE ps.professional_id = p.id AND s.category = ${filter.category})`);
    }
    if (filter.city) query = query.where(sql<boolean>`lower(p.city) = lower(${filter.city})`);
    if (filter.afterId) query = query.where("p.id", ">", filter.afterId);
    const rows = await query.orderBy("p.id").limit(filter.limit).execute();
    return rows.flatMap((r) => (r.display_name && r.city ? [{ id: r.id, displayName: r.display_name, bio: r.bio, city: r.city }] : []));
  }

  async activeOffersFor(trx: Kysely<Database>, professionalIds: string[]): Promise<Map<string, PublicOffer[]>> {
    const result = new Map<string, PublicOffer[]>();
    if (professionalIds.length === 0) return result;
    const rows = await trx
      .selectFrom("professional_offers")
      .select(["id", "professional_id", "specialty_id", "method", "duration_minutes", "price_kz", "note"])
      .where("professional_id", "in", professionalIds)
      .where("active", "=", true)
      .orderBy("specialty_id")
      .orderBy("method")
      .orderBy("duration_minutes")
      .execute();
    for (const r of rows) {
      const list = result.get(r.professional_id) ?? [];
      list.push({ id: r.id, specialtyId: r.specialty_id, method: r.method, durationMinutes: r.duration_minutes, priceKz: r.price_kz, note: r.note });
      result.set(r.professional_id, list);
    }
    return result;
  }

  async listApprovedForFacts(trx: Kysely<Database>, filter: FactsFilter): Promise<ApprovedFactsRow[]> {
    if (filter.ids?.length === 0) return [];
    let query = trx.selectFrom("professionals as p").select(["p.id", "p.display_name", "p.bio", "p.city", "p.approved_at"]).where("p.validation_status", "=", "APPROVED");
    if (filter.ids) query = query.where("p.id", "in", filter.ids);
    if (filter.specialtyId) {
      query = query.where(sql<boolean>`EXISTS (SELECT 1 FROM professional_specialties ps WHERE ps.professional_id = p.id AND ps.specialty_id = ${filter.specialtyId}::uuid)`);
    }
    if (filter.category) {
      query = query.where(sql<boolean>`EXISTS (SELECT 1 FROM professional_specialties ps JOIN specialties s ON s.id = ps.specialty_id WHERE ps.professional_id = p.id AND s.category = ${filter.category})`);
    }
    const rows = await query.orderBy("p.id").limit(filter.limit).execute();
    return rows.flatMap((r) => (r.display_name && r.city && r.approved_at ? [{ id: r.id, displayName: r.display_name, bio: r.bio, city: r.city, approvedAt: r.approved_at }] : []));
  }

  async slotStatsFor(trx: Kysely<Database>, professionalIds: string[], now: Date): Promise<Map<string, SlotStatRecord[]>> {
    const result = new Map<string, SlotStatRecord[]>();
    if (professionalIds.length === 0) return result;
    const horizon = new Date(now.getTime() + 14 * 24 * 3600 * 1000);
    const rows = await trx
      .selectFrom("professional_slots as sl")
      .innerJoin("professionals as p", "p.id", "sl.professional_id")
      .innerJoin("professional_offers as o", (join) => join.onRef("o.id", "=", "sl.offer_id").onRef("o.professional_id", "=", "sl.professional_id"))
      .select(["sl.professional_id", "sl.offer_id", sql<Date>`min(sl.starts_at)`.as("next_slot_at"), sql<string>`count(*) FILTER (WHERE sl.starts_at <= ${horizon})`.as("count_14d")])
      .where("sl.professional_id", "in", professionalIds)
      .where("p.validation_status", "=", "APPROVED")
      .where("o.active", "=", true)
      .where("sl.starts_at", ">", now)
      .groupBy(["sl.professional_id", "sl.offer_id"])
      .orderBy("sl.offer_id")
      .execute();
    for (const r of rows) {
      const list = result.get(r.professional_id) ?? [];
      list.push({ offerId: r.offer_id, nextSlotAt: r.next_slot_at, countNext14Days: Number(r.count_14d) });
      result.set(r.professional_id, list);
    }
    return result;
  }

  async bookableSlots(trx: Kysely<Database>, professionalId: string, from: Date, to: Date, now: Date): Promise<SlotRecord[]> {
    const rows = await trx
      .selectFrom("professional_slots as sl")
      .innerJoin("professionals as p", "p.id", "sl.professional_id")
      .innerJoin("professional_offers as o", (join) => join.onRef("o.id", "=", "sl.offer_id").onRef("o.professional_id", "=", "sl.professional_id"))
      .select(["sl.id", "sl.offer_id", "sl.rule_id", "sl.starts_at", "sl.ends_at"])
      .where("sl.professional_id", "=", professionalId)
      .where("p.validation_status", "=", "APPROVED")
      .where("o.active", "=", true)
      .where("sl.starts_at", ">", now)
      .where("sl.starts_at", ">=", from)
      .where("sl.starts_at", "<", to)
      .orderBy("sl.starts_at")
      .orderBy("sl.id")
      .execute();
    return rows.map((r) => ({ id: r.id, offerId: r.offer_id, ruleId: r.rule_id, startsAt: r.starts_at, endsAt: r.ends_at }));
  }
}

export class KyselyMaintenanceRepository implements MaintenanceRepository<Kysely<Database>> {
  async deleteExpiredAuthTokens(trx: Kysely<Database>, before: Date): Promise<number> {
    const result = await trx.deleteFrom("professional_auth_tokens").where((eb) => eb.or([eb("expires_at", "<", before), eb("used_at", "<", before)])).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async deleteExpiredSessions(trx: Kysely<Database>, before: Date): Promise<number> {
    // Só depois do fim de validade: uma sessão revogada ainda serve para detetar a reutilização do refresh até expirar.
    const result = await trx.deleteFrom("professional_sessions").where("expires_at", "<", before).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async listStalePendingCredentialIds(trx: Kysely<Database>, before: Date): Promise<string[]> {
    const rows = await trx.selectFrom("professional_credentials").select("id").where("scan_status", "=", "PENDING").where("created_at", "<", before).orderBy("created_at").limit(200).execute();
    return rows.map((r) => r.id);
  }
}
