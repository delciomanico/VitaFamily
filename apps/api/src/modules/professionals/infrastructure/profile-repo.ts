// Implementações Kysely/pg das portas `ProfessionalProfileRepository` e `ValidationCaseRepository` (application/ports.ts).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type {
  CredentialSummary,
  LinkedSpecialty,
  NewValidationCase,
  ProfessionalProfileRepository,
  ProfessionalRecord,
  StatusChange,
  ValidationCaseRepository,
} from "../application/ports.js";
import type { ProfilePatch } from "../domain/profile.js";
import "./schema.js";

interface ProfessionalRow {
  id: string;
  account_id: string;
  display_name: string | null;
  bio: string | null;
  city: string | null;
  payment_instructions: string | null;
  validation_status: ProfessionalRecord["validationStatus"];
  status_reason: string | null;
  status_changed_at: Date;
  submitted_at: Date | null;
  approved_at: Date | null;
  created_at: Date;
}

function toRecord(row: ProfessionalRow): ProfessionalRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    displayName: row.display_name,
    bio: row.bio,
    city: row.city,
    paymentInstructions: row.payment_instructions,
    validationStatus: row.validation_status,
    statusReason: row.status_reason,
    statusChangedAt: row.status_changed_at,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    createdAt: row.created_at,
  };
}

export class KyselyProfessionalProfileRepository implements ProfessionalProfileRepository<Kysely<Database>> {
  async findById(trx: Kysely<Database>, professionalId: string): Promise<ProfessionalRecord | null> {
    const row = await trx.selectFrom("professionals").selectAll().where("id", "=", professionalId).executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async findByIdForUpdate(trx: Kysely<Database>, professionalId: string): Promise<ProfessionalRecord | null> {
    const row = await trx.selectFrom("professionals").selectAll().where("id", "=", professionalId).forUpdate().executeTakeFirst();
    return row ? toRecord(row) : null;
  }

  async updateFields(trx: Kysely<Database>, professionalId: string, changes: ProfilePatch, now: Date): Promise<void> {
    await trx
      .updateTable("professionals")
      .set({
        ...(changes.displayName !== undefined ? { display_name: changes.displayName } : {}),
        ...(changes.bio !== undefined ? { bio: changes.bio } : {}),
        ...(changes.city !== undefined ? { city: changes.city } : {}),
        ...(changes.paymentInstructions !== undefined ? { payment_instructions: changes.paymentInstructions } : {}),
        updated_at: now,
      })
      .where("id", "=", professionalId)
      .execute();
  }

  async updateStatus(trx: Kysely<Database>, professionalId: string, change: StatusChange, now: Date): Promise<void> {
    await trx
      .updateTable("professionals")
      .set({
        validation_status: change.validationStatus,
        status_reason: change.statusReason,
        status_changed_at: change.statusChangedAt,
        ...(change.submittedAt !== undefined ? { submitted_at: change.submittedAt } : {}),
        ...(change.approvedAt !== undefined ? { approved_at: change.approvedAt } : {}),
        updated_at: now,
      })
      .where("id", "=", professionalId)
      .execute();
  }

  async listSpecialties(trx: Kysely<Database>, professionalId: string): Promise<LinkedSpecialty[]> {
    return trx
      .selectFrom("professional_specialties as ps")
      .innerJoin("specialties as s", "s.id", "ps.specialty_id")
      .select(["s.id", "s.name", "s.category", "s.active"])
      .where("ps.professional_id", "=", professionalId)
      .orderBy("s.name")
      .execute();
  }

  async lockSpecialtiesByIds(trx: Kysely<Database>, ids: string[]): Promise<LinkedSpecialty[]> {
    if (ids.length === 0) return [];
    return trx.selectFrom("specialties").select(["id", "name", "category", "active"]).where("id", "in", ids).forShare().execute();
  }

  async replaceSpecialties(trx: Kysely<Database>, professionalId: string, specialtyIds: string[]): Promise<void> {
    await trx.deleteFrom("professional_specialties").where("professional_id", "=", professionalId).where("specialty_id", "not in", specialtyIds).execute();
    await trx
      .insertInto("professional_specialties")
      .values(specialtyIds.map((specialty_id) => ({ professional_id: professionalId, specialty_id })))
      .onConflict((oc) => oc.columns(["professional_id", "specialty_id"]).doNothing())
      .execute();
  }

  async hasOffersForSpecialties(trx: Kysely<Database>, professionalId: string, specialtyIds: string[]): Promise<boolean> {
    if (specialtyIds.length === 0) return false;
    const result = await sql<{ found: number }>`
      SELECT 1 AS found FROM professional_offers WHERE professional_id = ${professionalId} AND specialty_id IN (${sql.join(specialtyIds)}) LIMIT 1`.execute(trx);
    return result.rows.length > 0;
  }

  async listCredentialSummaries(trx: Kysely<Database>, professionalId: string): Promise<CredentialSummary[]> {
    const rows = await trx.selectFrom("professional_credentials").select(["kind", "scan_status", "valid_until"]).where("professional_id", "=", professionalId).execute();
    return rows.map((r) => ({ kind: r.kind, scanStatus: r.scan_status, validUntil: r.valid_until }));
  }
}

export class KyselyValidationCaseRepository implements ValidationCaseRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewValidationCase): Promise<void> {
    await trx
      .insertInto("validation_cases")
      .values({
        id: record.id,
        professional_id: record.professionalId,
        action: record.action,
        from_status: record.fromStatus,
        to_status: record.toStatus,
        actor: record.actor,
        decided_by: record.decidedBy ?? null,
        reason: record.reason,
        created_at: record.createdAt,
      })
      .execute();
  }
}
