// Implementação Kysely/pg de `ReceiptsRepository` (schema.md §3f). Isolamento: TODA a consulta do portal filtra por `clinic_id`.
// O recibo é imutável: só se faz `UPDATE` de `status`/`voided_*` (BR-CLN-33); sem `DELETE` fora da cascata da clínica.
import { sql, type Kysely } from "kysely";
import { ConflictError } from "../../../platform/errors/index.js";
import type { Database } from "../../../platform/db/index.js";
import type { NewReceiptRecord, ReceiptListFilter, ReceiptPeriodSummary, ReceiptsRepository } from "../application/ports.js";
import type { ClinicReceipt, ReceiptBookingKind, ReceiptLine } from "../domain/receipt.js";
import "./schema.js";

const PG_UNIQUE_VIOLATION = "23505";

interface ReceiptRow {
  id: string;
  clinic_id: string;
  number: number;
  booking_kind: ReceiptBookingKind;
  booking_id: string;
  status: "ISSUED" | "VOIDED";
  payment_method: ClinicReceipt["paymentMethod"];
  currency: string;
  total_minor: string;
  patient_name: string;
  note: string | null;
  issuer: ClinicReceipt["issuer"];
  issued_at: Date;
  issued_by_clinic_account_id: string | null;
  voided_at: Date | null;
  void_reason: string | null;
  voided_by_clinic_account_id: string | null;
}

interface LineRow {
  receipt_id: string;
  position: number;
  description: string;
  amount_minor: string;
  service_type_id: string | null;
}

const RECEIPT_COLUMNS = [
  "id",
  "clinic_id",
  "number",
  "booking_kind",
  "booking_id",
  "status",
  "payment_method",
  "currency",
  "total_minor",
  "patient_name",
  "note",
  "issuer",
  "issued_at",
  "issued_by_clinic_account_id",
  "voided_at",
  "void_reason",
  "voided_by_clinic_account_id",
] as const;

function toReceipt(row: ReceiptRow, lines: ReceiptLine[]): ClinicReceipt {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    number: row.number,
    bookingKind: row.booking_kind,
    bookingId: row.booking_id,
    status: row.status,
    paymentMethod: row.payment_method,
    currency: row.currency.trim(),
    totalMinor: Number(row.total_minor),
    patientName: row.patient_name,
    note: row.note,
    issuer: row.issuer,
    lines,
    issuedAt: row.issued_at,
    issuedByClinicAccountId: row.issued_by_clinic_account_id,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    voidedByClinicAccountId: row.voided_by_clinic_account_id,
  };
}

export class KyselyReceiptsRepository implements ReceiptsRepository<Kysely<Database>> {
  private async hydrate(trx: Kysely<Database>, rows: ReceiptRow[]): Promise<ClinicReceipt[]> {
    if (rows.length === 0) return [];
    const lineRows: LineRow[] = await trx
      .selectFrom("clinic_receipt_lines")
      .select(["receipt_id", "position", "description", "amount_minor", "service_type_id"])
      .where("receipt_id", "in", rows.map((r) => r.id))
      .orderBy("position", "asc")
      .execute();
    const byReceipt = new Map<string, ReceiptLine[]>();
    for (const line of lineRows) {
      const list = byReceipt.get(line.receipt_id) ?? [];
      list.push({ position: line.position, description: line.description, amountMinor: Number(line.amount_minor), serviceTypeId: line.service_type_id });
      byReceipt.set(line.receipt_id, list);
    }
    return rows.map((row) => toReceipt(row, byReceipt.get(row.id) ?? []));
  }

  private async hydrateOne(trx: Kysely<Database>, row: ReceiptRow | undefined): Promise<ClinicReceipt | null> {
    return row ? ((await this.hydrate(trx, [row]))[0] ?? null) : null;
  }

  async nextNumber(trx: Kysely<Database>, clinicId: string): Promise<number> {
    const result = await sql<{ last_number: number }>`
      INSERT INTO clinic_receipt_counters (clinic_id, last_number) VALUES (${clinicId}, 1)
      ON CONFLICT (clinic_id) DO UPDATE SET last_number = clinic_receipt_counters.last_number + 1
      RETURNING last_number`.execute(trx);
    const row = result.rows[0];
    if (!row) throw new Error("contador de recibos sem resultado");
    return row.last_number;
  }

  async insert(trx: Kysely<Database>, record: NewReceiptRecord, number: number): Promise<ClinicReceipt> {
    try {
      await trx
        .insertInto("clinic_receipts")
        .values({
          id: record.id,
          clinic_id: record.clinicId,
          number,
          booking_kind: record.bookingKind,
          booking_id: record.bookingId,
          payment_method: record.paymentMethod,
          currency: record.currency,
          total_minor: record.totalMinor,
          patient_name: record.patientName,
          note: record.note,
          issuer: JSON.stringify(record.issuer),
          issued_at: record.issuedAt,
          issued_by_clinic_account_id: record.issuedByClinicAccountId,
        })
        .execute();
    } catch (error) {
      if (typeof error === "object" && error !== null && (error as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictError({ detail: "Já existe um recibo emitido para esta marcação." });
      }
      throw error;
    }
    await trx
      .insertInto("clinic_receipt_lines")
      .values(
        record.lines.map((line) => ({
          clinic_id: record.clinicId,
          receipt_id: record.id,
          position: line.position,
          description: line.description,
          amount_minor: line.amountMinor,
          service_type_id: line.serviceTypeId,
        })),
      )
      .execute();
    const row = await trx.selectFrom("clinic_receipts").select(RECEIPT_COLUMNS).where("id", "=", record.id).executeTakeFirstOrThrow();
    return toReceipt(row, record.lines);
  }

  async insertLink(trx: Kysely<Database>, receiptId: string, familyId: string, memberId: string, createdAt: Date): Promise<void> {
    await trx.insertInto("clinic_receipt_links").values({ receipt_id: receiptId, family_id: familyId, member_id: memberId, created_at: createdAt }).execute();
  }

  async findById(trx: Kysely<Database>, clinicId: string, receiptId: string, lock = false): Promise<ClinicReceipt | null> {
    let query = trx.selectFrom("clinic_receipts").select(RECEIPT_COLUMNS).where("clinic_id", "=", clinicId).where("id", "=", receiptId);
    if (lock) query = query.forUpdate();
    return this.hydrateOne(trx, await query.executeTakeFirst());
  }

  async findIssuedByBooking(trx: Kysely<Database>, clinicId: string, kind: ReceiptBookingKind, bookingId: string): Promise<ClinicReceipt | null> {
    const row = await trx
      .selectFrom("clinic_receipts")
      .select(RECEIPT_COLUMNS)
      .where("clinic_id", "=", clinicId)
      .where("booking_kind", "=", kind)
      .where("booking_id", "=", bookingId)
      .where("status", "=", "ISSUED")
      .executeTakeFirst();
    return this.hydrateOne(trx, row);
  }

  async findIssuedIdsByBookings(trx: Kysely<Database>, clinicId: string, kind: ReceiptBookingKind, bookingIds: string[]): Promise<Map<string, string>> {
    const rows = await trx
      .selectFrom("clinic_receipts")
      .select(["id", "booking_id"])
      .where("clinic_id", "=", clinicId)
      .where("booking_kind", "=", kind)
      .where("status", "=", "ISSUED")
      .where("booking_id", "in", bookingIds)
      .execute();
    return new Map(rows.map((r) => [r.booking_id, r.id]));
  }

  async markVoided(trx: Kysely<Database>, clinicId: string, receiptId: string, reason: string, accountId: string, now: Date): Promise<ClinicReceipt> {
    const row = await trx
      .updateTable("clinic_receipts")
      .set({ status: "VOIDED", voided_at: now, void_reason: reason, voided_by_clinic_account_id: accountId })
      .where("clinic_id", "=", clinicId)
      .where("id", "=", receiptId)
      .returning(RECEIPT_COLUMNS)
      .executeTakeFirstOrThrow();
    const [receipt] = await this.hydrate(trx, [row]);
    if (!receipt) throw new Error("recibo anulado não encontrado");
    return receipt;
  }

  async list(trx: Kysely<Database>, clinicId: string, filter: ReceiptListFilter, limit: number): Promise<ClinicReceipt[]> {
    let query = trx
      .selectFrom("clinic_receipts")
      .select(RECEIPT_COLUMNS)
      .where("clinic_id", "=", clinicId)
      .where("issued_at", ">=", filter.from)
      .where("issued_at", "<", filter.to);
    if (filter.status) query = query.where("status", "=", filter.status);
    if (filter.after) query = query.where(sql<boolean>`(issued_at, id) < (${filter.after.issuedAt}, ${filter.after.id}::uuid)`);
    const rows = await query.orderBy("issued_at", "desc").orderBy("id", "desc").limit(limit).execute();
    return this.hydrate(trx, rows);
  }

  async summarize(trx: Kysely<Database>, clinicId: string, from: Date, to: Date): Promise<ReceiptPeriodSummary> {
    const row = await trx
      .selectFrom("clinic_receipts")
      .select([
        sql<string>`count(*) filter (where status = 'ISSUED')`.as("issued_count"),
        sql<string>`coalesce(sum(total_minor) filter (where status = 'ISSUED'), 0)`.as("issued_total"),
        sql<string>`count(*) filter (where status = 'VOIDED')`.as("voided_count"),
      ])
      .where("clinic_id", "=", clinicId)
      .where("issued_at", ">=", from)
      .where("issued_at", "<", to)
      .executeTakeFirstOrThrow();
    return { issuedCount: Number(row.issued_count), issuedTotalMinor: Number(row.issued_total), voidedCount: Number(row.voided_count) };
  }

  async availableToPatient(trx: Kysely<Database>, receiptIds: string[]): Promise<Set<string>> {
    if (receiptIds.length === 0) return new Set();
    const rows = await trx.selectFrom("clinic_receipt_links").select("receipt_id").where("receipt_id", "in", receiptIds).execute();
    return new Set(rows.map((r) => r.receipt_id));
  }

  async listLinkedByMember(trx: Kysely<Database>, familyId: string, memberId: string, after: { issuedAt: Date; id: string } | undefined, limit: number): Promise<ClinicReceipt[]> {
    let query = trx
      .selectFrom("clinic_receipts as r")
      .innerJoin("clinic_receipt_links as l", "l.receipt_id", "r.id")
      .select(RECEIPT_COLUMNS.map((c) => `r.${c}` as const))
      .where("l.family_id", "=", familyId)
      .where("l.member_id", "=", memberId);
    if (after) query = query.where(sql<boolean>`(r.issued_at, r.id) < (${after.issuedAt}, ${after.id}::uuid)`);
    const rows = await query.orderBy("r.issued_at", "desc").orderBy("r.id", "desc").limit(limit).execute();
    return this.hydrate(trx, rows);
  }

  async findLinkedByMember(trx: Kysely<Database>, familyId: string, memberId: string, receiptId: string, lock = false): Promise<ClinicReceipt | null> {
    let query = trx
      .selectFrom("clinic_receipts as r")
      .innerJoin("clinic_receipt_links as l", "l.receipt_id", "r.id")
      .select(RECEIPT_COLUMNS.map((c) => `r.${c}` as const))
      .where("l.family_id", "=", familyId)
      .where("l.member_id", "=", memberId)
      .where("r.id", "=", receiptId);
    if (lock) query = query.forUpdate("r");
    return this.hydrateOne(trx, await query.executeTakeFirst());
  }

  async lockLinkedByMember(trx: Kysely<Database>, familyId: string, memberId: string, receiptIds: string[]): Promise<ClinicReceipt[]> {
    if (receiptIds.length === 0) return [];
    const rows = await trx
      .selectFrom("clinic_receipts as r")
      .innerJoin("clinic_receipt_links as l", "l.receipt_id", "r.id")
      .select(RECEIPT_COLUMNS.map((c) => `r.${c}` as const))
      .where("l.family_id", "=", familyId)
      .where("l.member_id", "=", memberId)
      .where("r.id", "in", receiptIds)
      .orderBy("r.id", "asc")
      .forUpdate("r")
      .execute();
    return this.hydrate(trx, rows);
  }

  async findManyByIds(trx: Kysely<Database>, receiptIds: string[]): Promise<ClinicReceipt[]> {
    if (receiptIds.length === 0) return [];
    const rows = await trx.selectFrom("clinic_receipts").select(RECEIPT_COLUMNS).where("id", "in", receiptIds).execute();
    return this.hydrate(trx, rows);
  }
}
