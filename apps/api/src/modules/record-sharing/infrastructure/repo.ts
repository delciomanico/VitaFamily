// `RecordShareRepository` (Kysely/pg). Toda a consulta da família leva (familyId, memberId); a do profissional leva `professional_id`.
// A abertura bem-sucedida é UM `UPDATE` condicional (BR-MKT-71): `view_count + 1` e, se `view_once`, `CONSUMED` — atómico por linha; as
// vistas só se inserem (a BD proíbe `UPDATE` em `record_share_views`). Nada aqui recebe nem devolve o conteúdo partilhado.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { DataCategory } from "../domain/index.js";
import type { RecordShareRecord, RecordShareRepository, ShareListFilter, ShareViewRecord } from "../application/ports.js";
import "./schema.js";

type Db = Kysely<Database>;

const COLUMNS = [
  "id", "family_id", "member_id", "professional_id", "booking_id", "participant_label", "professional_category", "validity", "view_once",
  "expires_at", "status", "revoked_at", "consumed_at", "view_count", "last_viewed_at", "created_by_user_id", "client_request_id", "created_at",
] as const;

const categoriesText = sql<string[]>`categories::text[]`.as("categories");

interface Row {
  id: string;
  family_id: string;
  member_id: string;
  professional_id: string;
  booking_id: string;
  participant_label: string;
  professional_category: RecordShareRecord["professionalCategory"];
  validity: RecordShareRecord["validity"];
  view_once: boolean;
  expires_at: Date;
  status: RecordShareRecord["status"];
  revoked_at: Date | null;
  consumed_at: Date | null;
  view_count: number;
  last_viewed_at: Date | null;
  created_by_user_id: string | null;
  client_request_id: string | null;
  created_at: Date;
  categories: string[];
}

export function toShare(r: Row): RecordShareRecord {
  return {
    id: r.id,
    familyId: r.family_id,
    memberId: r.member_id,
    professionalId: r.professional_id,
    bookingId: r.booking_id,
    participantLabel: r.participant_label,
    professionalCategory: r.professional_category,
    categories: r.categories as DataCategory[],
    validity: r.validity,
    viewOnce: r.view_once,
    expiresAt: r.expires_at,
    status: r.status,
    revokedAt: r.revoked_at,
    consumedAt: r.consumed_at,
    viewCount: r.view_count,
    lastViewedAt: r.last_viewed_at,
    createdByUserId: r.created_by_user_id,
    clientRequestId: r.client_request_id,
    createdAt: r.created_at,
  };
}

function selectShares(trx: Db) {
  return trx.selectFrom("record_shares").select([...COLUMNS, categoriesText]);
}

type SharesQuery = ReturnType<typeof selectShares>;

/** Filtros comuns às duas listas: estado derivado (`EXPIRED` não é coluna), marcação e cursor `(created_at, id)` decrescente. */
function applyListFilter(query: SharesQuery, filter: ShareListFilter): SharesQuery {
  let q = query;
  if (filter.bookingId) q = q.where("booking_id", "=", filter.bookingId);
  if (filter.status === "ACTIVE") q = q.where("status", "=", "ACTIVE").where("expires_at", ">", filter.now);
  else if (filter.status === "EXPIRED") q = q.where("status", "=", "ACTIVE").where("expires_at", "<=", filter.now);
  else if (filter.status) q = q.where("status", "=", filter.status);
  if (filter.after) {
    const { createdAt, id } = filter.after;
    q = q.where((eb) => eb.or([eb("created_at", "<", createdAt), eb.and([eb("created_at", "=", createdAt), eb("id", "<", id)])]));
  }
  return q.orderBy("created_at", "desc").orderBy("id", "desc").limit(filter.limit);
}

export class KyselyRecordShareRepository implements RecordShareRepository<Db> {
  async acquireLocks(trx: Db, keys: readonly string[]): Promise<void> {
    for (const key of [...keys].sort()) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
    }
  }

  async findForMember(trx: Db, familyId: string, memberId: string, shareId: string, forUpdate: boolean): Promise<RecordShareRecord | null> {
    let query = selectShares(trx).where("family_id", "=", familyId).where("member_id", "=", memberId).where("id", "=", shareId);
    if (forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toShare(row) : null;
  }

  async findByClientRequestId(trx: Db, memberId: string, clientRequestId: string): Promise<RecordShareRecord | null> {
    const row = await selectShares(trx).where("member_id", "=", memberId).where("client_request_id", "=", clientRequestId).executeTakeFirst();
    return row ? toShare(row) : null;
  }

  async countActive(trx: Db, memberId: string, now: Date): Promise<number> {
    const row = await trx
      .selectFrom("record_shares")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("member_id", "=", memberId)
      .where("status", "=", "ACTIVE")
      .where("expires_at", ">", now)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async createTimesByUser(trx: Db, userId: string, since: Date): Promise<Date[]> {
    const rows = await trx.selectFrom("record_shares").select("created_at").where("created_by_user_id", "=", userId).where("created_at", ">=", since).execute();
    return rows.map((r) => r.created_at);
  }

  async list(trx: Db, familyId: string, memberId: string, filter: ShareListFilter): Promise<RecordShareRecord[]> {
    const query = selectShares(trx).where("family_id", "=", familyId).where("member_id", "=", memberId);
    return (await applyListFilter(query, filter).execute()).map(toShare);
  }

  async insert(trx: Db, r: RecordShareRecord): Promise<void> {
    await trx
      .insertInto("record_shares")
      .values({
        id: r.id,
        family_id: r.familyId,
        member_id: r.memberId,
        professional_id: r.professionalId,
        booking_id: r.bookingId,
        participant_label: r.participantLabel,
        professional_category: r.professionalCategory,
        categories: sql`${r.categories}::text[]::data_category[]`,
        validity: r.validity,
        view_once: r.viewOnce,
        expires_at: r.expiresAt,
        status: r.status,
        created_by_user_id: r.createdByUserId,
        client_request_id: r.clientRequestId,
        created_at: r.createdAt,
        updated_at: r.createdAt,
      })
      .execute();
  }

  async markRevoked(trx: Db, shareId: string, change: { at: Date; byUserId: string }): Promise<void> {
    await trx
      .updateTable("record_shares")
      .set({ status: "REVOKED", revoked_at: change.at, revoked_by_user_id: change.byUserId, updated_at: change.at })
      .where("id", "=", shareId)
      .where("status", "=", "ACTIVE")
      .execute();
  }

  async listViews(trx: Db, shareId: string, limit: number, beforeViewNo?: number): Promise<ShareViewRecord[]> {
    let query = trx.selectFrom("record_share_views").select(["view_no", "viewed_at", sql<string[]>`categories::text[]`.as("categories")]).where("share_id", "=", shareId);
    if (beforeViewNo !== undefined) query = query.where("view_no", "<", beforeViewNo);
    const rows = await query.orderBy("view_no", "desc").limit(limit).execute();
    return rows.map((r) => ({ viewNo: r.view_no, viewedAt: r.viewed_at, categories: r.categories as DataCategory[] }));
  }

  async findForProfessional(trx: Db, professionalId: string, shareId: string, forUpdate: boolean): Promise<RecordShareRecord | null> {
    let query = selectShares(trx).where("professional_id", "=", professionalId).where("id", "=", shareId);
    if (forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toShare(row) : null;
  }

  async listForProfessional(trx: Db, professionalId: string, filter: ShareListFilter): Promise<RecordShareRecord[]> {
    return (await applyListFilter(selectShares(trx).where("professional_id", "=", professionalId), filter).execute()).map(toShare);
  }

  async commitOpen(trx: Db, shareId: string, input: { at: Date; categories: readonly DataCategory[] }): Promise<number | null> {
    const { at } = input;
    const updated = await sql<{ view_count: number }>`
      UPDATE record_shares
         SET view_count = view_count + 1,
             last_viewed_at = ${at}::timestamptz,
             status = CASE WHEN view_once THEN 'CONSUMED'::record_share_status ELSE status END,
             consumed_at = CASE WHEN view_once THEN ${at}::timestamptz ELSE consumed_at END,
             updated_at = ${at}::timestamptz
       WHERE id = ${shareId} AND status = 'ACTIVE' AND expires_at > ${at}::timestamptz
       RETURNING view_count`.execute(trx);
    const viewNo = updated.rows[0]?.view_count;
    if (viewNo === undefined) return null;
    await trx
      .insertInto("record_share_views")
      .values({ share_id: shareId, view_no: viewNo, viewed_at: at, categories: sql`${[...input.categories]}::text[]::data_category[]` })
      .execute();
    return viewNo;
  }
}
