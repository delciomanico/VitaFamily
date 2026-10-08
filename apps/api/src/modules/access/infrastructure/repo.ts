// Implementação Kysely/pg da porta `SharingGrantsRepository` (application/ports.ts). Toda
// consulta exige `familyId` (conventions.md §3.4) — nunca um "findById" global.
import type { Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { DataCategory, SharingGrant } from "../domain/sharing-grant.js";
import type { NewSharingGrantRecord, SharingGrantsRepository } from "../application/ports.js";
import "./schema.js";

interface GrantRow {
  id: string;
  family_id: string;
  owner_member_id: string;
  grantee_member_id: string | null;
  category: DataCategory;
  granted_by: string | null;
  created_at: Date;
}

const GRANT_COLUMNS = ["id", "family_id", "owner_member_id", "grantee_member_id", "category", "granted_by", "created_at"] as const;

function toGrant(row: GrantRow): SharingGrant {
  const grant: SharingGrant = {
    id: row.id,
    familyId: row.family_id,
    ownerMemberId: row.owner_member_id,
    category: row.category,
    createdAt: row.created_at,
  };
  if (row.grantee_member_id) {
    grant.granteeMemberId = row.grantee_member_id;
  }
  if (row.granted_by) {
    grant.grantedBy = row.granted_by;
  }
  return grant;
}

export class KyselySharingGrantsRepository implements SharingGrantsRepository<Kysely<Database>> {
  async listByOwner(trx: Kysely<Database>, familyId: string, ownerMemberId: string): Promise<SharingGrant[]> {
    const rows = await trx
      .selectFrom("sharing_grants")
      .select(GRANT_COLUMNS)
      .where("family_id", "=", familyId)
      .where("owner_member_id", "=", ownerMemberId)
      .execute();
    return rows.map(toGrant);
  }

  async listForGrantee(trx: Kysely<Database>, familyId: string, granteeId: string): Promise<SharingGrant[]> {
    const rows = await trx
      .selectFrom("sharing_grants")
      .select(GRANT_COLUMNS)
      .where("family_id", "=", familyId)
      .where((eb) => eb.or([eb("grantee_member_id", "=", granteeId), eb("grantee_member_id", "is", null)]))
      .execute();
    return rows.map(toGrant);
  }

  async hasGrant(
    trx: Kysely<Database>,
    familyId: string,
    ownerMemberId: string,
    granteeId: string,
    category: DataCategory,
  ): Promise<boolean> {
    const row = await trx
      .selectFrom("sharing_grants")
      .select(({ fn }) => fn.countAll().as("count"))
      .where("family_id", "=", familyId)
      .where("owner_member_id", "=", ownerMemberId)
      .where("category", "=", category)
      .where((eb) => eb.or([eb("grantee_member_id", "=", granteeId), eb("grantee_member_id", "is", null)]))
      .executeTakeFirstOrThrow();
    return Number(row.count) > 0;
  }

  async replaceForOwner(
    trx: Kysely<Database>,
    familyId: string,
    ownerMemberId: string,
    grants: NewSharingGrantRecord[],
  ): Promise<SharingGrant[]> {
    // BR-PRV-04: substituição atómica (a transação é do caso de uso, `withTransaction`).
    await trx.deleteFrom("sharing_grants").where("family_id", "=", familyId).where("owner_member_id", "=", ownerMemberId).execute();
    if (grants.length === 0) {
      return [];
    }
    const rows = await trx
      .insertInto("sharing_grants")
      .values(
        grants.map((grant) => ({
          id: grant.id,
          family_id: grant.familyId,
          owner_member_id: grant.ownerMemberId,
          grantee_member_id: grant.granteeMemberId ?? null,
          category: grant.category,
          granted_by: grant.grantedBy,
          created_at: grant.createdAt,
        })),
      )
      .returning(GRANT_COLUMNS)
      .execute();
    return rows.map(toGrant);
  }
}
