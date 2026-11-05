// Implementação Kysely/pg das portas de `documents` (application/ports.ts). Toda consulta de
// `documents` exige `familyId` (+ `memberId` nas rotas HTTP; `findByIdForFamily` é a única exceção
// documentada — usada só pelo worker `documents.scan`, que recebe o job sem `memberId`,
// conventions.md §3.4).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import { NotFoundError } from "../../../platform/errors/index.js";
import type { Document, ResourceType, ScanStatus } from "../domain/document.js";
import type { DocumentsRepository, FileDeletionsRepository, NewDocumentRecord, PendingFileDeletion } from "../application/ports.js";
import "./schema.js";

interface DocumentRow {
  id: string;
  family_id: string;
  member_id: string;
  prescription_id: string | null;
  examination_id: string | null;
  insurance_policy_id: string | null;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: string;
  checksum_sha256: string;
  scan_status: ScanStatus;
  uploaded_by: string | null;
  uploaded_by_clinic_account_id: string | null;
  uploaded_by_clinic: boolean;
  created_at: Date;
}

const DOCUMENT_COLUMNS = [
  "id",
  "family_id",
  "member_id",
  "prescription_id",
  "examination_id",
  "insurance_policy_id",
  "storage_key",
  "original_name",
  "mime_type",
  "size_bytes",
  "checksum_sha256",
  "scan_status",
  "uploaded_by",
  "uploaded_by_clinic_account_id",
  "uploaded_by_clinic",
  "created_at",
] as const;

/** `prescription_id`/`examination_id`/`insurance_policy_id` (schema.md §3: `num_nonnulls = 1`) <-> `resourceType`/`resourceId`. */
function toDocument(row: DocumentRow): Document {
  const resourceType: ResourceType = row.prescription_id !== null ? "PRESCRIPTION" : row.insurance_policy_id !== null ? "INSURANCE_POLICY" : "EXAMINATION";
  const resourceId = row.prescription_id ?? row.insurance_policy_id ?? row.examination_id;
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
    uploadedByClinic: row.uploaded_by_clinic,
    createdAt: row.created_at,
  };
  if (row.uploaded_by !== null) {
    document.uploadedBy = row.uploaded_by;
  }
  if (row.uploaded_by_clinic_account_id !== null) {
    document.uploadedByClinicAccountId = row.uploaded_by_clinic_account_id;
  }
  return document;
}

type ResourceColumn = "prescription_id" | "examination_id" | "insurance_policy_id";

const RESOURCE_COLUMN: Record<ResourceType, ResourceColumn> = {
  PRESCRIPTION: "prescription_id",
  EXAMINATION: "examination_id",
  INSURANCE_POLICY: "insurance_policy_id",
};

function resourceColumns(resourceType: ResourceType, resourceId: string): { prescription_id: string | null; examination_id: string | null; insurance_policy_id: string | null } {
  return { prescription_id: null, examination_id: null, insurance_policy_id: null, [RESOURCE_COLUMN[resourceType]]: resourceId };
}

export class KyselyDocumentsRepository implements DocumentsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewDocumentRecord): Promise<Document> {
    try {
      return await this.insertRow(trx, record);
    } catch (error) {
      // FK composta `documents_insurance_policy_fk` (0025): apólice inexistente OU de outro membro/família.
      const pg = error as { code?: string; constraint?: string } | null;
      if (pg?.code === "23503" && pg.constraint === "documents_insurance_policy_fk") {
        throw new NotFoundError({ detail: "Apólice não encontrada." });
      }
      throw error;
    }
  }

  private async insertRow(trx: Kysely<Database>, record: NewDocumentRecord): Promise<Document> {
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
        uploaded_by_clinic_account_id: record.uploadedByClinicAccountId ?? null,
        uploaded_by_clinic: record.uploadedByClinic ?? false,
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

  async listStorageKeysByMember(trx: Kysely<Database>, familyId: string, memberId: string): Promise<string[]> {
    const rows = await trx.selectFrom("documents").select("storage_key").where("family_id", "=", familyId).where("member_id", "=", memberId).execute();
    return rows.map((r) => r.storage_key);
  }

  async listStorageKeysByFamily(trx: Kysely<Database>, familyId: string): Promise<string[]> {
    const rows = await trx.selectFrom("documents").select("storage_key").where("family_id", "=", familyId).execute();
    return rows.map((r) => r.storage_key);
  }

  async listByIds(trx: Kysely<Database>, familyId: string, memberId: string, documentIds: string[]): Promise<Document[]> {
    if (documentIds.length === 0) {
      return [];
    }
    const rows = await trx
      .selectFrom("documents")
      .select(DOCUMENT_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "in", documentIds)
      .execute();
    return rows.map(toDocument);
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
    const column = RESOURCE_COLUMN[resourceType];
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
    const column = RESOURCE_COLUMN[resourceType];
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

  async listPending(trx: Kysely<Database>, limit: number, maxAttempts: number): Promise<PendingFileDeletion[]> {
    const rows = await trx
      .selectFrom("file_deletions")
      .select(["id", "storage_key"])
      .where("deleted_at", "is", null)
      .where("attempts", "<", maxAttempts)
      .orderBy("created_at", "asc")
      .limit(limit)
      .forUpdate()
      .skipLocked()
      .execute();
    return rows.map((r) => ({ id: r.id, storageKey: r.storage_key }));
  }

  async markDeleted(trx: Kysely<Database>, id: string, at: Date): Promise<void> {
    await trx.updateTable("file_deletions").set({ deleted_at: at }).where("id", "=", id).execute();
  }

  async recordFailure(trx: Kysely<Database>, id: string): Promise<void> {
    await trx.updateTable("file_deletions").set((eb) => ({ attempts: eb("attempts", "+", 1) })).where("id", "=", id).execute();
  }
}
