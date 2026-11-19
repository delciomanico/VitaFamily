// `DirectoryRepository` e `MaintenanceRepository` (Kysely/pg). O leitor público filtra `APPROVED` em CADA consulta (BR-MKT-19).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { ApprovedFactsRow, BookingFactsRow, ConversationIdentityRow, DirectoryFilter, FactsFilter, SlotStatRecord, DirectoryRepository, MaintenanceRepository, PublicOffer, PublicProfessionalRow, SlotRecord } from "../application/ports.js";
import type { SpecialtyCategory } from "../domain/requirements.js";
import "./schema.js";

export class KyselyDirectoryRepository implements DirectoryRepository<Kysely<Database>> {
  async findApproved(trx: Kysely<Database>, professionalId: string): Promise<PublicProfessionalRow | null> {
    const row = await trx.selectFrom("professionals").select(["id", "display_name", "bio", "city"]).where("id", "=", professionalId).where("validation_status", "=", "APPROVED").executeTakeFirst();
    return row?.display_name && row.city ? { id: row.id, displayName: row.display_name, bio: row.bio, city: row.city } : null;
  }

  async findNotificationEmail(trx: Kysely<Database>, professionalId: string): Promise<string | null> {
    const row = await trx.selectFrom("professionals as p").innerJoin("professional_accounts as a", "a.id", "p.account_id").select("a.email").where("p.id", "=", professionalId).executeTakeFirst();
    return row?.email ?? null;
  }

  async findConversationIdentities(trx: Kysely<Database>, ids: string[]): Promise<ConversationIdentityRow[]> {
    if (ids.length === 0) return [];
    const rows = await trx.selectFrom("professionals").select(["id", "display_name", "city", "validation_status"]).where("id", "in", ids).execute();
    return rows.map((r) => ({ id: r.id, displayName: r.display_name ?? "Profissional", city: r.city, approved: r.validation_status === "APPROVED" }));
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
      .where("sl.booking_id", "is", null)
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
      .select(["sl.id", "sl.offer_id", "sl.rule_id", "sl.starts_at", "sl.ends_at", "sl.booking_id"])
      .where("sl.professional_id", "=", professionalId)
      .where("p.validation_status", "=", "APPROVED")
      .where("o.active", "=", true)
      .where("sl.booking_id", "is", null)
      .where("sl.starts_at", ">", now)
      .where("sl.starts_at", ">=", from)
      .where("sl.starts_at", "<", to)
      .orderBy("sl.starts_at")
      .orderBy("sl.id")
      .execute();
    return rows.map((r) => ({ id: r.id, offerId: r.offer_id, ruleId: r.rule_id, startsAt: r.starts_at, endsAt: r.ends_at, bookingId: r.booking_id }));
  }

  async findBookingFacts(trx: Kysely<Database>, offerId: string, slotId: string): Promise<BookingFactsRow | null> {
    // APPROVED e oferta ativa lidos agora; o horário só se procura entre os do MESMO profissional (outro ⇒ como inexistente).
    const row = await trx
      .selectFrom("professional_offers as o")
      .innerJoin("professionals as p", "p.id", "o.professional_id")
      .select(["p.id as professional_id", "p.display_name", "p.city", "o.id as offer_id", "o.specialty_id", "o.method", "o.duration_minutes", "o.price_kz"])
      .where("o.id", "=", offerId)
      .where("o.active", "=", true)
      .where("p.validation_status", "=", "APPROVED")
      .executeTakeFirst();
    if (!row?.display_name || !row.city) return null;
    const slot = await trx
      .selectFrom("professional_slots")
      .select(["id", "offer_id", "starts_at", "ends_at", "booking_id"])
      .where("id", "=", slotId)
      .where("professional_id", "=", row.professional_id)
      .executeTakeFirst();
    return {
      professionalId: row.professional_id,
      displayName: row.display_name,
      city: row.city,
      offer: { id: row.offer_id, specialtyId: row.specialty_id, method: row.method, durationMinutes: row.duration_minutes, priceKz: row.price_kz },
      slot: slot ? { id: slot.id, offerId: slot.offer_id, startsAt: slot.starts_at, endsAt: slot.ends_at, booked: slot.booking_id !== null } : null,
    };
  }

  async reserveSlot(trx: Kysely<Database>, input: { bookingId: string; slotId: string; offerId: string; minStart: Date }): Promise<boolean> {
    // UPDATE condicional atómico (BR-MKT-53): a linha só muda se o horário continua livre, é da oferta, da oferta ativa de um APPROVED e com antecedência.
    const result = await trx
      .updateTable("professional_slots")
      .set({ booking_id: input.bookingId })
      .where("id", "=", input.slotId)
      .where("offer_id", "=", input.offerId)
      .where("booking_id", "is", null)
      .where("starts_at", ">=", input.minStart)
      .where(sql<boolean>`EXISTS (SELECT 1 FROM professionals p JOIN professional_offers o ON o.professional_id = p.id WHERE p.id = professional_slots.professional_id AND p.validation_status = 'APPROVED' AND o.id = professional_slots.offer_id AND o.active)`)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }

  async releaseSlot(trx: Kysely<Database>, bookingId: string): Promise<boolean> {
    const result = await trx.updateTable("professional_slots").set({ booking_id: null }).where("booking_id", "=", bookingId).executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  async findSpecialties(trx: Kysely<Database>, ids: string[]): Promise<{ id: string; name: string; category: SpecialtyCategory }[]> {
    if (ids.length === 0) return [];
    const rows = await trx.selectFrom("specialties").select(["id", "name", "category"]).where("id", "in", ids).execute();
    return rows.map((r) => ({ id: r.id, name: r.name, category: r.category }));
  }

  async findPaymentInstructions(trx: Kysely<Database>, professionalId: string): Promise<string | null> {
    const row = await trx.selectFrom("professionals").select("payment_instructions").where("id", "=", professionalId).executeTakeFirst();
    return row?.payment_instructions && row.payment_instructions.trim() !== "" ? row.payment_instructions : null;
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
