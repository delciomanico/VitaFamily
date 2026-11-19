// Implementação Kysely/pg de `FileDeletionRepository` (application/ports.ts) sobre `consultation_file_deletions`.
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { FileDeletionRepository } from "../application/ports.js";
import "./schema.js";

export class KyselyFileDeletionRepository implements FileDeletionRepository<Kysely<Database>> {
  async enqueue(trx: Kysely<Database>, storageKey: string): Promise<void> {
    await sql`INSERT INTO consultation_file_deletions (storage_key) VALUES (${storageKey})`.execute(trx);
  }

  async listPending(trx: Kysely<Database>, limit: number, maxAttempts: number): Promise<{ id: string; storageKey: string }[]> {
    const result = await sql<{ id: string; storage_key: string }>`
      SELECT id, storage_key FROM consultation_file_deletions
      WHERE deleted_at IS NULL AND attempts < ${maxAttempts} ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`.execute(trx);
    return result.rows.map((r) => ({ id: r.id, storageKey: r.storage_key }));
  }

  async markDeleted(trx: Kysely<Database>, id: string, now: Date): Promise<void> {
    await sql`UPDATE consultation_file_deletions SET deleted_at = ${now} WHERE id = ${id}`.execute(trx);
  }

  async recordFailure(trx: Kysely<Database>, id: string): Promise<void> {
    await sql`UPDATE consultation_file_deletions SET attempts = attempts + 1 WHERE id = ${id}`.execute(trx);
  }
}
