// Implementação Kysely/pg de `ReportsRepository` (schema.md §3g). Isolamento: TODA a consulta filtra por `clinic_id`.
// O `FINAL` e as adendas são imutáveis (trigger de BD); a aplicação nunca apaga relatórios (só a cascata da clínica).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type { ConsultationBookingKind, ConsultationReport, ReportAddendum } from "../domain/consultation-report.js";
import type { NewAddendumRecord, ReportRecord, ReportsRepository } from "../application/ports.js";
import "./schema.js";

const COLUMNS = [
  "id",
  "clinic_id",
  "booking_kind",
  "booking_id",
  "clinic_patient_id",
  "status",
  "reason",
  "findings",
  "impression",
  "plan",
  "shared_with_patient",
  "patient_name",
  "patient_birth_date",
  "consultation_at",
  "specialty",
  "author_name",
  "issuer",
  "author_account_id",
  "finalized_at",
  "created_at",
  "updated_at",
] as const;

interface ReportRow {
  id: string;
  clinic_id: string;
  booking_kind: ConsultationBookingKind;
  booking_id: string;
  clinic_patient_id: string | null;
  status: "DRAFT" | "FINAL";
  reason: string | null;
  findings: string | null;
  impression: string | null;
  plan: string | null;
  shared_with_patient: boolean;
  patient_name: string;
  patient_birth_date: string | Date | null;
  consultation_at: Date;
  specialty: string | null;
  author_name: string;
  issuer: ConsultationReport["issuer"];
  author_account_id: string | null;
  finalized_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

/** `pg` devolve `date` como `Date` local; normaliza para `AAAA-MM-DD`. */
function isoDate(value: string | Date | null): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value.slice(0, 10);
  const y = String(value.getFullYear()).padStart(4, "0");
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toReport(row: ReportRow, addenda: ReportAddendum[]): ConsultationReport {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    bookingKind: row.booking_kind,
    bookingId: row.booking_id,
    clinicPatientId: row.clinic_patient_id,
    status: row.status,
    reason: row.reason,
    findings: row.findings,
    impression: row.impression,
    plan: row.plan,
    sharedWithPatient: row.shared_with_patient,
    patientName: row.patient_name,
    patientBirthDate: isoDate(row.patient_birth_date),
    consultationAt: row.consultation_at,
    specialty: row.specialty,
    authorName: row.author_name,
    issuer: row.issuer,
    authorAccountId: row.author_account_id,
    finalizedAt: row.finalized_at,
    addenda,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyReportsRepository implements ReportsRepository<Kysely<Database>> {
  async upsert(trx: Kysely<Database>, r: ReportRecord): Promise<ConsultationReport | null> {
    const values = {
      clinic_patient_id: r.clinicPatientId,
      status: r.status,
      reason: r.reason,
      findings: r.findings,
      impression: r.impression,
      plan: r.plan,
      shared_with_patient: r.sharedWithPatient,
      patient_name: r.patientName,
      patient_birth_date: r.patientBirthDate,
      consultation_at: r.consultationAt,
      specialty: r.specialty,
      author_name: r.authorName,
      issuer: r.issuer ? JSON.stringify(r.issuer) : null,
      author_account_id: r.authorAccountId,
      finalized_at: r.finalizedAt,
    };
    const row = await trx
      .insertInto("clinic_consultation_reports")
      .values({ id: r.id, clinic_id: r.clinicId, booking_kind: r.bookingKind, booking_id: r.bookingId, ...values, created_at: r.now, updated_at: r.now })
      .onConflict((oc) =>
        oc
          .columns(["clinic_id", "booking_kind", "booking_id"])
          .doUpdateSet({ ...values, updated_at: r.now })
          // O FINAL nunca se reescreve (BR-CLN-43): sem linha devolvida => já estava FINAL.
          .where("clinic_consultation_reports.status", "=", "DRAFT"),
      )
      .returning(COLUMNS)
      .executeTakeFirst();
    if (!row) return null;
    return toReport(row, await this.listAddenda(trx, r.clinicId, row.id));
  }

  async findByBooking(trx: Kysely<Database>, clinicId: string, kind: ConsultationBookingKind, bookingId: string, lock = false): Promise<ConsultationReport | null> {
    let query = trx.selectFrom("clinic_consultation_reports").select(COLUMNS).where("clinic_id", "=", clinicId).where("booking_kind", "=", kind).where("booking_id", "=", bookingId);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toReport(row, await this.listAddenda(trx, clinicId, row.id)) : null;
  }

  async findByBookingId(trx: Kysely<Database>, clinicId: string, bookingId: string): Promise<ConsultationReport | null> {
    const row = await trx.selectFrom("clinic_consultation_reports").select(COLUMNS).where("clinic_id", "=", clinicId).where("booking_id", "=", bookingId).executeTakeFirst();
    return row ? toReport(row, await this.listAddenda(trx, clinicId, row.id)) : null;
  }

  private async listAddenda(trx: Kysely<Database>, clinicId: string, reportId: string): Promise<ReportAddendum[]> {
    const rows = await trx
      .selectFrom("clinic_consultation_report_addenda")
      .select(["id", "text", "author_name", "author_account_id", "created_at"])
      .where("clinic_id", "=", clinicId)
      .where("report_id", "=", reportId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map((a) => ({ id: a.id, text: a.text, authorName: a.author_name, authorAccountId: a.author_account_id, createdAt: a.created_at }));
  }

  async countAddenda(trx: Kysely<Database>, clinicId: string, reportId: string): Promise<number> {
    const row = await trx.selectFrom("clinic_consultation_report_addenda").select(sql<string>`count(*)`.as("count")).where("clinic_id", "=", clinicId).where("report_id", "=", reportId).executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async insertAddendum(trx: Kysely<Database>, r: NewAddendumRecord): Promise<void> {
    await trx
      .insertInto("clinic_consultation_report_addenda")
      .values({ id: r.id, clinic_id: r.clinicId, report_id: r.reportId, text: r.text, author_name: r.authorName, author_account_id: r.authorAccountId, created_at: r.createdAt })
      .execute();
  }

  async statusesByBookings(trx: Kysely<Database>, clinicId: string, kind: ConsultationBookingKind, bookingIds: string[]): Promise<Map<string, "DRAFT" | "FINAL">> {
    if (bookingIds.length === 0) return new Map();
    const rows = await trx
      .selectFrom("clinic_consultation_reports")
      .select(["booking_id", "status"])
      .where("clinic_id", "=", clinicId)
      .where("booking_kind", "=", kind)
      .where("booking_id", "in", bookingIds)
      .execute();
    return new Map(rows.map((r) => [r.booking_id, r.status]));
  }

  async sharedFinalAppointments(trx: Kysely<Database>, bookings: { clinicId: string; bookingId: string }[]): Promise<Set<string>> {
    const byClinic = new Map<string, string[]>();
    for (const b of bookings) byClinic.set(b.clinicId, [...(byClinic.get(b.clinicId) ?? []), b.bookingId]);
    const found = new Set<string>();
    for (const [clinicId, ids] of byClinic) {
      const rows = await trx
        .selectFrom("clinic_consultation_reports")
        .select("booking_id")
        .where("clinic_id", "=", clinicId)
        .where("booking_kind", "=", "APPOINTMENT")
        .where("status", "=", "FINAL")
        .where("shared_with_patient", "=", true)
        .where("booking_id", "in", ids)
        .execute();
      for (const r of rows) found.add(r.booking_id);
    }
    return found;
  }
}
