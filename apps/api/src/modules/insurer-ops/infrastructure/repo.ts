// Implementações Kysely/pg das portas de `insurer-ops` (application/ports.ts). Toda consulta filtra por `insurer_id`
// (BR-SEG-14); as FKs compostas `(insurer_id, id)` garantem na BD que nada cruza seguradoras. Sem RLS (Q13).
import type { Kysely } from "kysely";
import { ConflictError } from "../../../platform/errors/index.js";
import type { Database } from "../../../platform/db/index.js";
import type {
  BeneficiariesRepository,
  BeneficiaryFilter,
  CompaniesRepository,
  ImportsRepository,
  LinkRequestsRepository,
  NewBeneficiaryRecord,
  NewPolicyRecord,
  PageQuery,
  PlanRef,
  PoliciesRepository,
} from "../application/ports.js";
import type { Beneficiary, BeneficiaryPatch, BeneficiaryStatus } from "../domain/beneficiary.js";
import type { Company, CompanyPatch, CompanyStatus } from "../domain/company.js";
import type { ImportBatch, ImportReport, ImportStatus } from "../domain/import-batch.js";
import type { ImportFormat, ImportRow } from "../domain/import-file.js";
import type { LinkRequest, LinkRequestStatus, LinkRequestTarget } from "../domain/link-request.js";
import type { Policy, PolicyPatch, PolicyStatus } from "../domain/policy.js";
import "./schema.js";
import { guard, INSERT_CHUNK, keyset, likeContains, required } from "./db-helpers.js";

type Db = Kysely<Database>;

// ---------- Empresas ----------

interface CompanyRow {
  id: string;
  insurer_id: string;
  name: string;
  tax_id: string;
  status: CompanyStatus;
  created_at: Date;
}

const toCompany = (r: CompanyRow): Company => ({ id: r.id, insurerId: r.insurer_id, name: r.name, taxId: r.tax_id, status: r.status, createdAt: r.created_at });

export class KyselyCompaniesRepository implements CompaniesRepository<Db> {
  async insert(trx: Db, record: { id: string; insurerId: string; name: string; taxId: string; createdAt: Date }): Promise<Company> {
    return guard(
      async () =>
        toCompany(
          await trx
            .insertInto("insurer_companies")
            .values({ id: record.id, insurer_id: record.insurerId, name: record.name, tax_id: record.taxId, created_at: record.createdAt, updated_at: record.createdAt })
            .returningAll()
            .executeTakeFirstOrThrow(),
        ),
      "Já existe uma empresa com este NIF.",
    );
  }

  async findById(trx: Db, insurerId: string, id: string): Promise<Company | null> {
    const row = await trx.selectFrom("insurer_companies").selectAll().where("insurer_id", "=", insurerId).where("id", "=", id).executeTakeFirst();
    return row ? toCompany(row) : null;
  }

  async findByTaxId(trx: Db, insurerId: string, taxId: string): Promise<Company | null> {
    const row = await trx.selectFrom("insurer_companies").selectAll().where("insurer_id", "=", insurerId).where("tax_id", "=", taxId).executeTakeFirst();
    return row ? toCompany(row) : null;
  }

  async findTaxIds(trx: Db, insurerId: string, taxIds: string[]): Promise<string[]> {
    if (taxIds.length === 0) return [];
    const rows = await trx.selectFrom("insurer_companies").select("tax_id").where("insurer_id", "=", insurerId).where("tax_id", "in", taxIds).execute();
    return rows.map((r) => r.tax_id);
  }

  async idsByTaxId(trx: Db, insurerId: string, taxIds: string[]): Promise<Map<string, string>> {
    if (taxIds.length === 0) return new Map();
    const rows = await trx.selectFrom("insurer_companies").select(["id", "tax_id"]).where("insurer_id", "=", insurerId).where("tax_id", "in", taxIds).execute();
    return new Map(rows.map((r) => [r.tax_id, r.id]));
  }

  async list(trx: Db, insurerId: string, filter: { status?: CompanyStatus }, page: PageQuery): Promise<Company[]> {
    let query = trx.selectFrom("insurer_companies as c").selectAll("c").where("c.insurer_id", "=", insurerId);
    if (filter.status) query = query.where("c.status", "=", filter.status);
    return (await keyset(query, "c", page).execute()).map(toCompany);
  }

  async update(trx: Db, insurerId: string, id: string, patch: CompanyPatch, now: Date): Promise<Company> {
    const row = await trx
      .updateTable("insurer_companies")
      .set({ updated_at: now, ...(patch.name === undefined ? {} : { name: patch.name }), ...(patch.status === undefined ? {} : { status: patch.status }) })
      .where("insurer_id", "=", insurerId)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toCompany(row);
  }
}

// ---------- Beneficiários ----------

interface BeneficiaryRow {
  id: string;
  insurer_id: string;
  company_id: string | null;
  holder_id: string | null;
  name: string;
  id_document_type: string;
  id_document_number: string;
  birth_date: string;
  relationship: Beneficiary["relationship"];
  card_number: string;
  card_version: number;
  status: BeneficiaryStatus;
  status_note: string | null;
  family_member_id: string | null;
  created_at: Date;
}

const toBeneficiary = (r: BeneficiaryRow): Beneficiary => ({
  id: r.id,
  insurerId: r.insurer_id,
  companyId: r.company_id,
  holderId: r.holder_id,
  name: r.name,
  idDocumentType: r.id_document_type,
  idDocumentNumber: r.id_document_number,
  birthDate: r.birth_date,
  relationship: r.relationship,
  cardNumber: r.card_number,
  cardVersion: r.card_version,
  status: r.status,
  linked: r.family_member_id !== null,
  statusNote: r.status_note,
  createdAt: r.created_at,
});

/** Colunas lidas (sem `claim_code_*` nem `family_id`: nunca saem da persistência). */
const BENEFICIARY_COLUMNS = [
  "b.id",
  "b.insurer_id",
  "b.company_id",
  "b.holder_id",
  "b.name",
  "b.id_document_type",
  "b.id_document_number",
  "b.birth_date",
  "b.relationship",
  "b.card_number",
  "b.card_version",
  "b.status",
  "b.status_note",
  "b.family_member_id",
  "b.created_at",
] as const;

const toInsertValues = (r: NewBeneficiaryRecord) => ({
  id: r.id,
  insurer_id: r.insurerId,
  company_id: r.companyId,
  holder_id: r.holderId,
  name: r.name,
  id_document_type: r.idDocumentType,
  id_document_number: r.idDocumentNumber,
  birth_date: r.birthDate,
  relationship: r.relationship,
  card_number: r.cardNumber,
  status: "PENDING" as const,
  created_at: r.createdAt,
  updated_at: r.createdAt,
});

export class KyselyBeneficiariesRepository implements BeneficiariesRepository<Db> {
  private select(trx: Db, insurerId: string) {
    return trx.selectFrom("insurer_beneficiaries as b").select([...BENEFICIARY_COLUMNS]).where("b.insurer_id", "=", insurerId);
  }

  async insert(trx: Db, record: NewBeneficiaryRecord): Promise<Beneficiary> {
    await guard(() => trx.insertInto("insurer_beneficiaries").values(toInsertValues(record)).execute(), "Já existe um beneficiário com este documento ou cartão.");
    return required(await this.findById(trx, record.insurerId, record.id));
  }

  async insertMany(trx: Db, records: NewBeneficiaryRecord[]): Promise<void> {
    for (let i = 0; i < records.length; i += INSERT_CHUNK) {
      const chunk = records.slice(i, i + INSERT_CHUNK).map(toInsertValues);
      await guard(() => trx.insertInto("insurer_beneficiaries").values(chunk).execute(), "Conflito ao gravar beneficiários; tente novamente.");
    }
  }

  async findById(trx: Db, insurerId: string, id: string, lock = false): Promise<Beneficiary | null> {
    let query = this.select(trx, insurerId).where("b.id", "=", id);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toBeneficiary(row) : null;
  }

  async findByDocument(trx: Db, insurerId: string, type: string, number: string): Promise<Beneficiary | null> {
    const row = await this.select(trx, insurerId).where("b.id_document_type", "=", type).where("b.id_document_number", "=", number).executeTakeFirst();
    return row ? toBeneficiary(row) : null;
  }

  async list(trx: Db, insurerId: string, filter: BeneficiaryFilter, page: PageQuery): Promise<Beneficiary[]> {
    let query = this.select(trx, insurerId);
    if (filter.status) query = query.where("b.status", "=", filter.status);
    if (filter.companyId) query = query.where("b.company_id", "=", filter.companyId);
    if (filter.holderId) query = query.where("b.holder_id", "=", filter.holderId);
    if (filter.relationship) query = query.where("b.relationship", "=", filter.relationship);
    if (filter.q) {
      const q = filter.q;
      // Nome por contém (sem distinguir maiúsculas); cartão e documento por igualdade exata.
      query = query.where((eb) => eb.or([eb("b.name", "ilike", likeContains(q)), eb("b.card_number", "=", q), eb("b.id_document_number", "=", q)]));
    }
    return (await keyset(query, "b", page).execute()).map(toBeneficiary);
  }

  async update(trx: Db, insurerId: string, id: string, patch: BeneficiaryPatch, now: Date): Promise<Beneficiary> {
    await trx
      .updateTable("insurer_beneficiaries")
      .set({
        updated_at: now,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.birthDate === undefined ? {} : { birth_date: patch.birthDate }),
        ...(patch.companyId === undefined ? {} : { company_id: patch.companyId }),
      })
      .where("insurer_id", "=", insurerId)
      .where("id", "=", id)
      .execute();
    return required(await this.findById(trx, insurerId, id));
  }

  async setStatus(trx: Db, insurerId: string, id: string, status: BeneficiaryStatus, note: string | null, now: Date): Promise<Beneficiary> {
    await trx.updateTable("insurer_beneficiaries").set({ status, status_note: note, updated_at: now }).where("insurer_id", "=", insurerId).where("id", "=", id).execute();
    return required(await this.findById(trx, insurerId, id));
  }

  async setClaimCode(trx: Db, insurerId: string, id: string, claim: { hash: string; expiresAt: Date }, now: Date): Promise<void> {
    await trx
      .updateTable("insurer_beneficiaries")
      .set({ claim_code_hash: claim.hash, claim_code_expires_at: claim.expiresAt, updated_at: now })
      .where("insurer_id", "=", insurerId)
      .where("id", "=", id)
      .execute();
  }

  async existingDocumentKeys(trx: Db, insurerId: string, numbers: string[]): Promise<Set<string>> {
    if (numbers.length === 0) return new Set();
    const rows = await trx.selectFrom("insurer_beneficiaries").select(["id_document_type", "id_document_number"]).where("insurer_id", "=", insurerId).where("id_document_number", "in", numbers).execute();
    return new Set(rows.map((r) => `${r.id_document_type}|${r.id_document_number}`));
  }

  async holderCountsByNumber(trx: Db, insurerId: string, numbers: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (numbers.length === 0) return counts;
    const rows = await trx.selectFrom("insurer_beneficiaries").select("id_document_number").where("insurer_id", "=", insurerId).where("relationship", "=", "HOLDER").where("id_document_number", "in", numbers).execute();
    for (const r of rows) counts.set(r.id_document_number, (counts.get(r.id_document_number) ?? 0) + 1);
    return counts;
  }

  async holderIdsByNumber(trx: Db, insurerId: string, numbers: string[]): Promise<Map<string, string>> {
    const ids = new Map<string, string>();
    if (numbers.length === 0) return ids;
    const rows = await trx.selectFrom("insurer_beneficiaries").select(["id", "id_document_number"]).where("insurer_id", "=", insurerId).where("relationship", "=", "HOLDER").where("id_document_number", "in", numbers).execute();
    const seen = new Set<string>();
    for (const r of rows) {
      if (seen.has(r.id_document_number)) ids.delete(r.id_document_number); // ambíguo: nunca se resolve
      else {
        seen.add(r.id_document_number);
        ids.set(r.id_document_number, r.id);
      }
    }
    return ids;
  }

  async existingCardNumbers(trx: Db, insurerId: string, cardNumbers: string[]): Promise<Set<string>> {
    if (cardNumbers.length === 0) return new Set();
    const rows = await trx.selectFrom("insurer_beneficiaries").select("card_number").where("insurer_id", "=", insurerId).where("card_number", "in", cardNumbers).execute();
    return new Set(rows.map((r) => r.card_number));
  }

  async link(trx: Db, insurerId: string, id: string, target: LinkRequestTarget, now: Date): Promise<void> {
    const result = await guard(
      () =>
        trx
          .updateTable("insurer_beneficiaries")
          .set({ family_id: target.familyId, family_member_id: target.familyMemberId, updated_at: now })
          .where("insurer_id", "=", insurerId)
          .where("id", "=", id)
          .where("family_member_id", "is", null)
          .executeTakeFirst(),
      "Esta ligação já existe nesta seguradora.",
    );
    if (Number(result.numUpdatedRows) === 0) throw new ConflictError({ detail: "O beneficiário já tem uma ligação confirmada." });
  }

  async hasAny(trx: Db, insurerId: string): Promise<boolean> {
    return (await trx.selectFrom("insurer_beneficiaries").select("id").where("insurer_id", "=", insurerId).limit(1).executeTakeFirst()) !== undefined;
  }
}

// ---------- Pedidos de ligação ----------

interface LinkRequestRow {
  id: string;
  insurer_id: string;
  beneficiary_id: string;
  beneficiary_name: string;
  card_number: string;
  status: LinkRequestStatus;
  created_at: Date;
  decided_at: Date | null;
  decision_note: string | null;
}

const toLinkRequest = (r: LinkRequestRow): LinkRequest => ({
  id: r.id,
  insurerId: r.insurer_id,
  beneficiaryId: r.beneficiary_id,
  beneficiaryName: r.beneficiary_name,
  cardNumber: r.card_number,
  status: r.status,
  createdAt: r.created_at,
  decidedAt: r.decided_at,
  decisionNote: r.decision_note,
});

export class KyselyLinkRequestsRepository implements LinkRequestsRepository<Db> {
  private select(trx: Db, insurerId: string) {
    return trx
      .selectFrom("insurer_beneficiary_link_requests as lr")
      .innerJoin("insurer_beneficiaries as b", (join) => join.onRef("b.insurer_id", "=", "lr.insurer_id").onRef("b.id", "=", "lr.beneficiary_id"))
      .select(["lr.id", "lr.insurer_id", "lr.beneficiary_id", "b.name as beneficiary_name", "b.card_number", "lr.status", "lr.created_at", "lr.decided_at", "lr.decision_note"])
      .where("lr.insurer_id", "=", insurerId);
  }

  async list(trx: Db, insurerId: string, filter: { status: LinkRequestStatus }, page: PageQuery): Promise<LinkRequest[]> {
    return (await keyset(this.select(trx, insurerId).where("lr.status", "=", filter.status), "lr", page).execute()).map(toLinkRequest);
  }

  async findById(trx: Db, insurerId: string, id: string, lock = false): Promise<{ request: LinkRequest; target: LinkRequestTarget } | null> {
    // Bloqueia primeiro: o SELECT seguinte (novo snapshot em READ COMMITTED) já vê a decisão de quem tinha o bloqueio.
    if (lock) await trx.selectFrom("insurer_beneficiary_link_requests").select("id").where("insurer_id", "=", insurerId).where("id", "=", id).forUpdate().execute();
    const row = await this.select(trx, insurerId).where("lr.id", "=", id).executeTakeFirst();
    if (!row) return null;
    const target = await trx.selectFrom("insurer_beneficiary_link_requests").select(["family_id", "family_member_id"]).where("insurer_id", "=", insurerId).where("id", "=", id).executeTakeFirstOrThrow();
    return { request: toLinkRequest(row), target: { familyId: target.family_id, familyMemberId: target.family_member_id } };
  }

  async decide(trx: Db, insurerId: string, id: string, decision: { status: "CONFIRMED" | "REJECTED"; note: string | null; accountId: string; decidedAt: Date }): Promise<LinkRequest> {
    await trx
      .updateTable("insurer_beneficiary_link_requests")
      .set({ status: decision.status, decision_note: decision.note, decided_by_insurance_account_id: decision.accountId, decided_at: decision.decidedAt, updated_at: decision.decidedAt })
      .where("insurer_id", "=", insurerId)
      .where("id", "=", id)
      .execute();
    return toLinkRequest(await this.select(trx, insurerId).where("lr.id", "=", id).executeTakeFirstOrThrow());
  }
}

// ---------- Apólices ----------

interface PolicyRow {
  id: string;
  insurer_id: string;
  number: string;
  plan_id: string;
  plan_name: string;
  plan_version: number;
  company_id: string | null;
  holder_id: string;
  valid_from: string;
  valid_to: string;
  status: PolicyStatus;
  status_note: string | null;
  created_at: Date;
}

const toPolicy = (r: PolicyRow): Policy => ({
  id: r.id,
  insurerId: r.insurer_id,
  number: r.number,
  planId: r.plan_id,
  planName: r.plan_name,
  planVersion: r.plan_version,
  companyId: r.company_id,
  holderId: r.holder_id,
  validFrom: r.valid_from,
  validTo: r.valid_to,
  status: r.status,
  statusNote: r.status_note,
  createdAt: r.created_at,
});

export class KyselyPoliciesRepository implements PoliciesRepository<Db> {
  private select(trx: Db, insurerId: string) {
    return trx
      .selectFrom("insurer_policies as p")
      .innerJoin("insurer_plans as pl", (join) => join.onRef("pl.insurer_id", "=", "p.insurer_id").onRef("pl.id", "=", "p.plan_id"))
      .select(["p.id", "p.insurer_id", "p.number", "p.plan_id", "pl.name as plan_name", "pl.version as plan_version", "p.company_id", "p.holder_id", "p.valid_from", "p.valid_to", "p.status", "p.status_note", "p.created_at"])
      .where("p.insurer_id", "=", insurerId);
  }

  async insert(trx: Db, record: NewPolicyRecord): Promise<Policy> {
    await guard(
      () =>
        trx
          .insertInto("insurer_policies")
          .values({
            id: record.id,
            insurer_id: record.insurerId,
            plan_id: record.planId,
            company_id: record.companyId,
            holder_id: record.holderId,
            number: record.number,
            valid_from: record.validFrom,
            valid_to: record.validTo,
            created_at: record.createdAt,
            updated_at: record.createdAt,
          })
          .execute(),
      "Já existe uma apólice com este número.",
    );
    return required(await this.findById(trx, record.insurerId, record.id));
  }

  async findById(trx: Db, insurerId: string, id: string, lock = false): Promise<Policy | null> {
    if (lock) await trx.selectFrom("insurer_policies").select("id").where("insurer_id", "=", insurerId).where("id", "=", id).forUpdate().execute();
    const row = await this.select(trx, insurerId).where("p.id", "=", id).executeTakeFirst();
    return row ? toPolicy(row) : null;
  }

  async list(trx: Db, insurerId: string, filter: { status?: PolicyStatus; companyId?: string; holderId?: string; q?: string }, page: PageQuery): Promise<Policy[]> {
    let query = this.select(trx, insurerId);
    if (filter.status) query = query.where("p.status", "=", filter.status);
    if (filter.companyId) query = query.where("p.company_id", "=", filter.companyId);
    if (filter.holderId) query = query.where("p.holder_id", "=", filter.holderId);
    if (filter.q) query = query.where("p.number", "ilike", likeContains(filter.q));
    return (await keyset(query, "p", page).execute()).map(toPolicy);
  }

  async update(trx: Db, insurerId: string, id: string, patch: PolicyPatch, now: Date): Promise<Policy> {
    await trx
      .updateTable("insurer_policies")
      .set({
        updated_at: now,
        ...(patch.planId === undefined ? {} : { plan_id: patch.planId }),
        ...(patch.companyId === undefined ? {} : { company_id: patch.companyId }),
        ...(patch.validFrom === undefined ? {} : { valid_from: patch.validFrom }),
        ...(patch.validTo === undefined ? {} : { valid_to: patch.validTo }),
      })
      .where("insurer_id", "=", insurerId)
      .where("id", "=", id)
      .execute();
    return required(await this.findById(trx, insurerId, id));
  }

  async setStatus(trx: Db, insurerId: string, id: string, status: PolicyStatus, note: string | null, now: Date): Promise<Policy> {
    await trx.updateTable("insurer_policies").set({ status, status_note: note, updated_at: now }).where("insurer_id", "=", insurerId).where("id", "=", id).execute();
    return required(await this.findById(trx, insurerId, id));
  }

  async findPlan(trx: Db, insurerId: string, planId: string): Promise<PlanRef | null> {
    const row = await trx.selectFrom("insurer_plans").select(["id", "status"]).where("insurer_id", "=", insurerId).where("id", "=", planId).executeTakeFirst();
    return row ?? null;
  }

  async expireDue(trx: Db, today: string, now: Date): Promise<{ insurerId: string; count: number }[]> {
    const rows = await trx
      .updateTable("insurer_policies")
      .set({ status: "EXPIRED", updated_at: now })
      .where("status", "=", "ACTIVE")
      .where("valid_to", "<", today)
      .returning("insurer_id")
      .execute();
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.insurer_id, (counts.get(r.insurer_id) ?? 0) + 1);
    return [...counts].map(([insurerId, count]) => ({ insurerId, count }));
  }

  async hasAny(trx: Db, insurerId: string): Promise<boolean> {
    return (await trx.selectFrom("insurer_policies").select("id").where("insurer_id", "=", insurerId).limit(1).executeTakeFirst()) !== undefined;
  }
}

// ---------- Lotes de importação ----------

interface BatchRow {
  id: string;
  insurer_id: string;
  format: ImportFormat;
  row_count: number;
  status: ImportStatus;
  error_report: unknown;
  rows: unknown;
  created_at: Date;
}

const toBatch = (r: BatchRow): ImportBatch => ({
  id: r.id,
  insurerId: r.insurer_id,
  format: r.format,
  rowCount: r.row_count,
  status: r.status,
  report: r.error_report as ImportReport,
  rows: r.rows === null ? null : (r.rows as ImportRow[]),
  createdAt: r.created_at,
});

export class KyselyImportsRepository implements ImportsRepository<Db> {
  async insert(trx: Db, record: { id: string; insurerId: string; format: ImportFormat; rowCount: number; report: ImportReport; rows: ImportRow[]; createdBy: string; createdAt: Date }): Promise<ImportBatch> {
    const row = await trx
      .insertInto("insurer_import_batches")
      .values({
        id: record.id,
        insurer_id: record.insurerId,
        format: record.format,
        row_count: record.rowCount,
        error_report: JSON.stringify(record.report),
        rows: JSON.stringify(record.rows),
        created_by_insurance_account_id: record.createdBy,
        created_at: record.createdAt,
        updated_at: record.createdAt,
      })
      .returning(["id", "insurer_id", "format", "row_count", "status", "error_report", "rows", "created_at"])
      .executeTakeFirstOrThrow();
    return toBatch(row);
  }

  async findById(trx: Db, insurerId: string, id: string, lock = false): Promise<ImportBatch | null> {
    let query = trx.selectFrom("insurer_import_batches").select(["id", "insurer_id", "format", "row_count", "status", "error_report", "rows", "created_at"]).where("insurer_id", "=", insurerId).where("id", "=", id);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toBatch(row) : null;
  }

  async close(trx: Db, insurerId: string, id: string, status: Extract<ImportStatus, "COMMITTED" | "CANCELLED">, report: ImportReport, now: Date): Promise<ImportBatch> {
    const row = await trx
      .updateTable("insurer_import_batches")
      .set({ status, error_report: JSON.stringify(report), rows: null, updated_at: now })
      .where("insurer_id", "=", insurerId)
      .where("id", "=", id)
      .returning(["id", "insurer_id", "format", "row_count", "status", "error_report", "rows", "created_at"])
      .executeTakeFirstOrThrow();
    return toBatch(row);
  }

  async expireStalePreviews(trx: Db, olderThan: Date, now: Date): Promise<{ insurerId: string; count: number }[]> {
    const rows = await trx
      .updateTable("insurer_import_batches")
      .set({ status: "CANCELLED", rows: null, updated_at: now })
      .where("status", "=", "PREVIEW")
      .where("created_at", "<", olderThan)
      .returning("insurer_id")
      .execute();
    const counts = new Map<string, number>();
    for (const r of rows) counts.set(r.insurer_id, (counts.get(r.insurer_id) ?? 0) + 1);
    return [...counts].map(([insurerId, count]) => ({ insurerId, count }));
  }
}
