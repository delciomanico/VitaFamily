// `AiConsentRepository` (Kysely/pg). Toda a consulta leva o utilizador (os consentimentos são de quem consentiu, BR-AI-03).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { AiConsentRecord, AiConsentRepository } from "../application/ports.js";
import "./schema.js";

type Db = Kysely<Database>;

interface Row {
  id: string;
  user_id: string;
  family_id: string;
  member_id: string;
  provider: AiConsentRecord["provider"];
  consent_version: string;
  granted_at: Date;
  revoked_at: Date | null;
}

const COLUMNS = ["id", "user_id", "family_id", "member_id", "provider", "consent_version", "granted_at", "revoked_at"] as const;

const toRecord = (r: Row): AiConsentRecord => ({
  id: r.id,
  userId: r.user_id,
  familyId: r.family_id,
  memberId: r.member_id,
  provider: r.provider,
  consentVersion: r.consent_version,
  grantedAt: r.granted_at,
  revokedAt: r.revoked_at,
});

export class KyselyAiConsentRepository implements AiConsentRepository<Db> {
  async acquireLocks(trx: Db, keys: readonly string[]): Promise<void> {
    for (const key of [...keys].sort()) {
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
    }
  }

  async listByUserAndMember(trx: Db, userId: string, memberId: string): Promise<AiConsentRecord[]> {
    const rows = await trx.selectFrom("ai_consents").select(COLUMNS).where("user_id", "=", userId).where("member_id", "=", memberId).orderBy("granted_at", "desc").execute();
    return rows.map(toRecord);
  }

  async findActive(trx: Db, userId: string, memberId: string, provider: AiConsentRecord["provider"]): Promise<AiConsentRecord | null> {
    const row = await trx
      .selectFrom("ai_consents")
      .select(COLUMNS)
      .where("user_id", "=", userId)
      .where("member_id", "=", memberId)
      .where("provider", "=", provider)
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async insert(trx: Db, record: Omit<AiConsentRecord, "revokedAt">): Promise<void> {
    await trx
      .insertInto("ai_consents")
      .values({ id: record.id, user_id: record.userId, family_id: record.familyId, member_id: record.memberId, provider: record.provider, consent_version: record.consentVersion, granted_at: record.grantedAt })
      .execute();
  }

  async revoke(trx: Db, id: string, at: Date): Promise<void> {
    await trx.updateTable("ai_consents").set({ revoked_at: at, updated_at: at }).where("id", "=", id).where("revoked_at", "is", null).execute();
  }
}
