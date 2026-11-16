// Implementações Kysely/pg de `CredentialRepository` e `FileDeletionRepository` (application/ports.ts).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { CredentialRecord, CredentialRepository, FileDeletionRepository, NewCredentialRecord } from "../application/ports.js";
import "./schema.js";

interface CredentialRow {
  id: string;
  professional_id: string;
  kind: CredentialRecord["kind"];
  number: string | null;
  issuing_body: string | null;
  valid_until: string | null;
  storage_key: string;
  content_type: string;
  size_bytes: number;
  scan_status: CredentialRecord["scanStatus"];
  created_at: Date;
}

function toRecord(row: CredentialRow): CredentialRecord {
  return {
    id: row.id,
    professionalId: row.professional_id,
    kind: row.kind,
    number: row.number,
    issuingBody: row.issuing_body,
    validUntil: row.valid_until,
    storageKey: row.storage_key,
    contentType: row.content_type as CredentialRecord["contentType"],
    sizeBytes: row.size_bytes,
    scanStatus: row.scan_status,
    createdAt: row.created_at,
  };
}

export class KyselyCredentialRepository implements CredentialRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewCredentialRecord): Promise<CredentialRecord> {
    const row = await trx
      .insertInto("professional_credentials")
      .values({
        id: record.id,
        professional_id: record.professionalId,
        kind: record.kind,
        number: record.number,
        issuing_body: record.issuingBody,
        valid_until: record.validUntil,
        storage_key: record.storageKey,
        content_type: record.contentType,
        size_bytes: record.sizeBytes,
        created_at: record.createdAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRecord(row);
  }

  async listByProfessional(trx: Kysely<Database>, professionalId: string): Promise<CredentialRecord[]> {
    const rows = await trx.selectFrom("professional_credentials").selectAll().where("professional_id", "=", professionalId).orderBy("created_at").orderBy("id").execute();
    return rows.map(toRecord);
  }

  async countByProfessional(trx: Kysely<Database>, professionalId: string): Promise<number> {
    const row = await trx.selectFrom("professional_credentials").select(sql<number>`count(*)::int`.as("n")).where("professional_id", "=", professionalId).executeTakeFirstOrThrow();
    return row.n;
  }

  async findOwned(trx: Kysely<Database>, professionalId: string, credentialId: string, options: { forUpdate?: boolean } = {}): Promise<CredentialRecord | null> {
    let query = trx.selectFrom("professional_credentials").selectAll().where("id", "=", credentialId).where("professional_id", "=", professionalId);
    if (options.forUpdate) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async findByIdForScan(trx: Kysely<Database>, credentialId: string): Promise<CredentialRecord | null> {
    const row = await trx.selectFrom("professional_credentials").selectAll().where("id", "=", credentialId).forUpdate().executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async delete(trx: Kysely<Database>, professionalId: string, credentialId: string): Promise<void> {
    await trx.deleteFrom("professional_credentials").where("id", "=", credentialId).where("professional_id", "=", professionalId).execute();
  }

  async markClean(trx: Kysely<Database>, credentialId: string, storageKey: string, now: Date): Promise<void> {
    await trx.updateTable("professional_credentials").set({ scan_status: "CLEAN", storage_key: storageKey, scanned_at: now, updated_at: now }).where("id", "=", credentialId).execute();
  }

  async markInfected(trx: Kysely<Database>, credentialId: string, now: Date): Promise<void> {
    await trx.updateTable("professional_credentials").set({ scan_status: "INFECTED", scanned_at: now, updated_at: now }).where("id", "=", credentialId).execute();
  }
}

export class KyselyFileDeletionRepository implements FileDeletionRepository<Kysely<Database>> {
  async enqueue(trx: Kysely<Database>, storageKey: string): Promise<void> {
    await sql`INSERT INTO professional_file_deletions (storage_key) VALUES (${storageKey})`.execute(trx);
  }

  async listPending(trx: Kysely<Database>, limit: number, maxAttempts: number): Promise<{ id: string; storageKey: string }[]> {
    const result = await sql<{ id: string; storage_key: string }>`
      SELECT id, storage_key FROM professional_file_deletions
      WHERE deleted_at IS NULL AND attempts < ${maxAttempts} ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`.execute(trx);
    return result.rows.map((r) => ({ id: r.id, storageKey: r.storage_key }));
  }

  async markDeleted(trx: Kysely<Database>, id: string, now: Date): Promise<void> {
    await sql`UPDATE professional_file_deletions SET deleted_at = ${now} WHERE id = ${id}`.execute(trx);
  }

  async recordFailure(trx: Kysely<Database>, id: string): Promise<void> {
    await sql`UPDATE professional_file_deletions SET attempts = attempts + 1 WHERE id = ${id}`.execute(trx);
  }
}
