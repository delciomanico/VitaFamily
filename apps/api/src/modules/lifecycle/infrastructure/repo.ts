// Implementação Kysely/pg da porta `ExportsRepository` (application/ports.ts).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { ExportsRepository, NewExportRecord } from "../application/ports.js";
import type { DataExport } from "../domain/export.js";
import "./schema.js";

interface ExportRow {
  id: string;
  requested_by: string;
  family_id: string | null;
  subject_member_id: string | null;
  reason: DataExport["reason"];
  status: DataExport["status"];
  storage_key: string | null;
  expires_at: Date | null;
  created_at: Date;
}

const COLUMNS = ["id", "requested_by", "family_id", "subject_member_id", "reason", "status", "storage_key", "expires_at", "created_at"] as const;

function toDomain(row: ExportRow): DataExport {
  const item: DataExport = { id: row.id, requestedBy: row.requested_by, reason: row.reason, status: row.status, createdAt: row.created_at };
  if (row.family_id !== null) item.familyId = row.family_id;
  if (row.subject_member_id !== null) item.subjectMemberId = row.subject_member_id;
  if (row.storage_key !== null) item.storageKey = row.storage_key;
  if (row.expires_at !== null) item.expiresAt = row.expires_at;
  return item;
}

export class KyselyExportsRepository implements ExportsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewExportRecord): Promise<DataExport> {
    const row = await trx
      .insertInto("data_exports")
      .values({
        id: record.id,
        requested_by: record.requestedBy,
        family_id: record.familyId ?? null,
        subject_member_id: record.subjectMemberId ?? null,
        reason: record.reason,
        created_at: record.createdAt,
      })
      .returning(COLUMNS)
      .executeTakeFirstOrThrow();
    return toDomain(row);
  }

  async findById(trx: Kysely<Database>, id: string, requestedBy: string): Promise<DataExport | null> {
    const row = await trx.selectFrom("data_exports").select(COLUMNS).where("id", "=", id).where("requested_by", "=", requestedBy).executeTakeFirst();
    return row ? toDomain(row) : null;
  }

  async countSince(trx: Kysely<Database>, requestedBy: string, since: Date): Promise<number> {
    const row = await trx
      .selectFrom("data_exports")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("requested_by", "=", requestedBy)
      .where("created_at", ">", since)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async markReady(trx: Kysely<Database>, id: string, storageKey: string, expiresAt: Date): Promise<void> {
    await trx.updateTable("data_exports").set({ status: "READY", storage_key: storageKey, expires_at: expiresAt, updated_at: sql`now()` }).where("id", "=", id).execute();
  }

  async markFailed(trx: Kysely<Database>, id: string): Promise<void> {
    await trx.updateTable("data_exports").set({ status: "FAILED", updated_at: sql`now()` }).where("id", "=", id).execute();
  }
}
