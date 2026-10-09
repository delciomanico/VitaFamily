// Implementação Kysely/pg das portas de `documents` (application/ports.ts). Toda consulta de
// `documents` exige `familyId` (+ `memberId` nas rotas HTTP; `findByIdForFamily` é a única exceção
// documentada — usada só pelo worker `documents.scan`, que recebe o job sem `memberId`,
// conventions.md §3.4).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { Document, ResourceType, ScanStatus } from "../domain/document.js";
import type { DocumentsRepository, FileDeletionsRepository, NewDocumentRecord } from "../application/ports.js";
import "./schema.js";

interface DocumentRow {
  id: string;
  family_id: string;
  member_id: string;
  prescription_id: string | null;
  examination_id: string | null;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  checksum_sha256: string;
  scan_status: ScanStatus;
  uploaded_by: string | null;
  created_at: Date;
}

const DOCUMENT_COLUMNS = [
  "id",
  "family_id",
  "member_id",
  "prescription_id",
  "examination_id",
  "storage_key",
  "original_name",
  "mime_type",
  "size_bytes",
  "checksum_sha256",
  "scan_status",
  "uploaded_by",
  "created_at",
] as const;

/** `prescription_id`/`examination_id` (schema.md §3: `num_nonnulls = 1`) <-> `resourceType`/`resourceId`. */
function toDocument(row: DocumentRow): Document {
  const resourceType: ResourceType = row.prescription_id !== null ? "PRESCRIPTION" : "EXAMINATION";
  const resourceId = row.prescription_id ?? row.examination_id;
  if (resourceId === null) {
    throw new Error(`documento sem recurso associado (CHECK num_nonnulls violado?): ${row.id}`);
  }
  const document: Document = {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    resourceType,
    resourceId,
    storageKey: row.storage_key,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    checksumSha256: row.checksum_sha256,
    scanStatus: row.scan_status,
    createdAt: row.created_at,
  };
  if (row.uploaded_by !== null) {
    document.uploadedBy = row.uploaded_by;
  }
  return document;
}

function resourceColumns(resourceType: ResourceType, resourceId: string): { prescription_id: string | null; examination_id: string | null } {
  return resourceType === "PRESCRIPTION"
    ? { prescription_id: resourceId, examination_id: null }
    : { prescription_id: null, examination_id: resourceId };
}

export class KyselyDocumentsRepository implements DocumentsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewDocumentRecord): Promise<Document> {
    const row = await trx
      .insertInto("documents")
      .values({
        id: record.id,
        family_id: record.familyId,
        member_id: record.memberId,
        ...resourceColumns(record.resourceType, record.resourceId),
        storage_key: record.storageKey,
        original_name: record.originalName,
        mime_type: record.mimeType,
        size_bytes: record.sizeBytes,
        checksum_sha256: record.checksumSha256,
        uploaded_by: record.uploadedBy ?? null,
        created_at: record.createdAt,
      })
      .returning(DOCUMENT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toDocument(row);
  }

  async findById(trx: Kysely<Database>, familyId: string, memberId: string, documentId: string): Promise<Document | null> {
    const row = await trx
      .selectFrom("documents")
      .select(DOCUMENT_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", documentId)
      .executeTakeFirst();
    return row ? toDocument(row) : null;
  }

  async findByIdForFamily(trx: Kysely<Database>, familyId: string, documentId: string): Promise<Document | null> {
    const row = await trx
      .selectFrom("documents")
      .select(DOCUMENT_COLUMNS)
      .where("family_id", "=", familyId)
      .where("id", "=", documentId)
      .executeTakeFirst();
    return row ? toDocument(row) : null;
  }

  async listByResource(
    trx: Kysely<Database>,
    familyId: string,
    memberId: string,
    resourceType: ResourceType,
    resourceId: string,
  ): Promise<Document[]> {
    const column = resourceType === "PRESCRIPTION" ? "prescription_id" : "examination_id";
    const rows = await trx
      .selectFrom("documents")
      .select(DOCUMENT_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where(column, "=", resourceId)
      .orderBy("created_at", "asc")
      .execute();
    return rows.map(toDocument);
  }

  async countByResource(
    trx: Kysely<Database>,
    familyId: string,
    memberId: string,
    resourceType: ResourceType,
    resourceId: string,
  ): Promise<number> {
    const column = resourceType === "PRESCRIPTION" ? "prescription_id" : "examination_id";
    const row = await trx
      .selectFrom("documents")
      .select(sql<string>`count(*)`.as("count"))
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where(column, "=", resourceId)
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async sumSizeByFamily(trx: Kysely<Database>, familyId: string): Promise<number> {
    const row = await trx
      .selectFrom("documents")
      .select(sql<string>`coalesce(sum(size_bytes), 0)`.as("total"))
      .where("family_id", "=", familyId)
      .executeTakeFirstOrThrow();
    return Number(row.total);
  }

  async markClean(trx: Kysely<Database>, documentId: string, finalStorageKey: string): Promise<Document> {
    const row = await trx
      .updateTable("documents")
      .set({ scan_status: "CLEAN", storage_key: finalStorageKey, updated_at: sql`now()` })
      .where("id", "=", documentId)
      .returning(DOCUMENT_COLUMNS)
      .executeTakeFirstOrThrow();
    return toDocument(row);
  }

  async delete(trx: Kysely<Database>, familyId: string, memberId: string, documentId: string): Promise<void> {
    await trx
      .deleteFrom("documents")
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", documentId)
      .execute();
  }
}

export class KyselyFileDeletionsRepository implements FileDeletionsRepository<Kysely<Database>> {
  async enqueue(trx: Kysely<Database>, storageKey: string): Promise<void> {
    await trx.insertInto("file_deletions").values({ storage_key: storageKey }).execute();
  }
}
