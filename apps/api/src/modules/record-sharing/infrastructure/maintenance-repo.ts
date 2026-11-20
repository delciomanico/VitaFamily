// Retenção das partilhas (BR-MKT-76): `DELETE` por fim real; as vistas vão em cascata (FK `ON DELETE CASCADE`).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { ShareRetentionRepository } from "../application/maintenance.js";
import "./schema.js";

type Db = Kysely<Database>;

export class KyselyShareRetentionRepository implements ShareRetentionRepository<Db> {
  async monthsBefore(trx: Db, now: Date, months: number): Promise<Date> {
    const result = await sql<{ t: Date }>`SELECT (${now}::timestamptz - make_interval(months => ${months})) AS t`.execute(trx);
    const row = result.rows[0];
    if (!row) throw new Error("monthsBefore sem resultado");
    return row.t;
  }

  async purgeEndedBefore(trx: Db, cutoff: Date): Promise<number> {
    // `expires_at` é NOT NULL; os terminais acrescentam `revoked_at`/`consumed_at` (um só deles, por CHECK). `ACTIVE` não expirada tem fim futuro.
    const result = await sql`
      DELETE FROM record_shares
       WHERE GREATEST(expires_at, COALESCE(revoked_at, expires_at), COALESCE(consumed_at, expires_at)) < ${cutoff}::timestamptz`.execute(trx);
    return Number(result.numAffectedRows ?? 0);
  }
}
