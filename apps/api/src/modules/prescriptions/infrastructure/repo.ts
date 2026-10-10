// Implementação Kysely/pg das portas de `prescriptions` (application/ports.ts). Toda consulta
// exige `familyId`+`memberId` (conventions.md §3.4).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { Prescription, PrescriptionStatus } from "../domain/prescription.js";
import type { CursorPage, PrescriptionChanges, PrescriptionListFilter, PrescriptionsRepository, NewPrescriptionRecord } from "../application/ports.js";
import "./schema.js";

interface PrescriptionRow {
  id: string;
  family_id: string;
  member_id: string;
  issued_on: string;
  doctor_name: string | null;
  notes: string | null;
  status: PrescriptionStatus;
  created_at: Date;
}

function toPrescription(row: PrescriptionRow): Prescription {
  const prescription: Prescription = {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    issuedOn: row.issued_on,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.doctor_name !== null) prescription.doctorName = row.doctor_name;
  if (row.notes !== null) prescription.notes = row.notes;
  return prescription;
}

const PRESCRIPTION_COLUMNS = ["id", "family_id", "member_id", "issued_on", "doctor_name", "notes", "status", "created_at"] as const;

export class KyselyPrescriptionsRepository implements PrescriptionsRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewPrescriptionRecord): Promise<Prescription> {
    const row = await trx
      .insertInto("prescriptions")
      .values({
        id: record.id,
        family_id: record.familyId,
        member_id: record.memberId,
        issued_on: record.issuedOn,
        doctor_name: record.doctorName ?? null,
        notes: record.notes ?? null,
        status: "ACTIVE",
        created_at: record.createdAt,
      })
      .returning(PRESCRIPTION_COLUMNS)
      .executeTakeFirstOrThrow();
    return toPrescription(row);
  }

  async findById(trx: Kysely<Database>, familyId: string, memberId: string, prescriptionId: string): Promise<Prescription | null> {
    const row = await trx
      .selectFrom("prescriptions")
      .select(PRESCRIPTION_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", prescriptionId)
      .executeTakeFirst();
    return row ? toPrescription(row) : null;
  }

  async listByMember(trx: Kysely<Database>, familyId: string, memberId: string, filter: PrescriptionListFilter, limit: number, cursor?: string): Promise<CursorPage<Prescription>> {
    let query = trx.selectFrom("prescriptions").select(PRESCRIPTION_COLUMNS).where("family_id", "=", familyId).where("member_id", "=", memberId);
    if (filter.status) {
      query = query.where("status", "=", filter.status);
    }
    if (cursor) {
      const decoded = decodeCursor(cursor);
      const after = new Date(decoded.createdAt);
      query = query.where((eb) => eb.or([eb("created_at", ">", after), eb.and([eb("created_at", "=", after), eb("id", ">", decoded.id)])]));
    }
    const rows = await query
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .limit(limit + 1)
      .execute();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id }) : null;
    return { items: page.map(toPrescription), nextCursor };
  }

  async update(trx: Kysely<Database>, familyId: string, memberId: string, prescriptionId: string, changes: PrescriptionChanges): Promise<Prescription> {
    const row = await trx
      .updateTable("prescriptions")
      .set({
        ...(changes.issuedOn !== undefined ? { issued_on: changes.issuedOn } : {}),
        ...(changes.doctorName !== undefined ? { doctor_name: changes.doctorName } : {}),
        ...(changes.notes !== undefined ? { notes: changes.notes } : {}),
        updated_at: sql`now()`,
      })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", prescriptionId)
      .returning(PRESCRIPTION_COLUMNS)
      .executeTakeFirstOrThrow();
    return toPrescription(row);
  }

  async updateStatus(trx: Kysely<Database>, familyId: string, memberId: string, prescriptionId: string, status: PrescriptionStatus): Promise<Prescription> {
    const row = await trx
      .updateTable("prescriptions")
      .set({ status, updated_at: sql`now()` })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", prescriptionId)
      .returning(PRESCRIPTION_COLUMNS)
      .executeTakeFirstOrThrow();
    return toPrescription(row);
  }

  async delete(trx: Kysely<Database>, familyId: string, memberId: string, prescriptionId: string): Promise<void> {
    await trx.deleteFrom("prescriptions").where("family_id", "=", familyId).where("member_id", "=", memberId).where("id", "=", prescriptionId).execute();
  }
}
