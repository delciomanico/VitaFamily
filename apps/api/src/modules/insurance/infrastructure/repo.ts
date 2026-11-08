// Implementações Kysely/pg das portas de `insurance` (application/ports.ts).
import { sql, type Kysely } from "kysely";
import type { Database } from "../../../platform/db/index.js";
import type {
  ClaimDecisionRecord,
  InsuranceAccountCredentialsReset,
  InsurancePoliciesRepository,
  InsurancePolicyChanges,
  NewClaimRecord,
  NewInsurancePolicyRecord,
  PortalClaim,
  ReimbursementClaimsRepository,
  InsuranceAccountRepository,
  InsuranceSessionRepository,
  InsurerChanges,
  InsurersRepository,
  NewInsuranceAccountRecord,
  NewInsuranceSessionRecord,
  NewInsurerRecord,
} from "../application/ports.js";
import type { InsuranceAccount, InsuranceAccountRole, InsuranceAccountStatus } from "../domain/insurance-account.js";
import type { InsuranceSession } from "../domain/insurance-session.js";
import type { InsurancePolicy } from "../domain/insurance-policy.js";
import type { Insurer, InsurerStatus } from "../domain/insurer.js";
import type { ClaimStatus, ReimbursementClaim } from "../domain/reimbursement-claim.js";
import "./schema.js";

interface InsurerRow {
  id: string;
  name: string;
  tax_id: string;
  status: InsurerStatus;
  created_by: string | null;
  created_at: Date;
}

function toInsurer(row: InsurerRow): Insurer {
  const insurer: Insurer = { id: row.id, name: row.name, taxId: row.tax_id, status: row.status, createdAt: row.created_at };
  if (row.created_by !== null) insurer.createdBy = row.created_by;
  return insurer;
}

export class KyselyInsurersRepository implements InsurersRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewInsurerRecord): Promise<Insurer> {
    const row = await trx
      .insertInto("insurer_accounts")
      .values({
        id: record.id,
        name: record.name,
        tax_id: record.taxId,
        status: "ACTIVE",
        created_by: record.createdBy ?? null,
        created_at: record.createdAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return toInsurer(row);
  }

  async findById(trx: Kysely<Database>, insurerId: string): Promise<Insurer | null> {
    const row = await trx.selectFrom("insurer_accounts").selectAll().where("id", "=", insurerId).executeTakeFirst();
    return row ? toInsurer(row) : null;
  }

  async findByTaxId(trx: Kysely<Database>, taxId: string): Promise<Insurer | null> {
    const row = await trx.selectFrom("insurer_accounts").selectAll().where("tax_id", "=", taxId).executeTakeFirst();
    return row ? toInsurer(row) : null;
  }

  async list(trx: Kysely<Database>): Promise<Insurer[]> {
    const rows = await trx.selectFrom("insurer_accounts").selectAll().orderBy("name", "asc").orderBy("created_at", "asc").execute();
    return rows.map(toInsurer);
  }

  async listActive(trx: Kysely<Database>): Promise<Insurer[]> {
    const rows = await trx.selectFrom("insurer_accounts").selectAll().where("status", "=", "ACTIVE").orderBy("name", "asc").orderBy("created_at", "asc").execute();
    return rows.map(toInsurer);
  }

  async update(trx: Kysely<Database>, insurerId: string, changes: InsurerChanges): Promise<Insurer> {
    const row = await trx
      .updateTable("insurer_accounts")
      .set({
        updated_at: sql`now()`,
        ...(changes.name !== undefined ? { name: changes.name } : {}),
        ...(changes.taxId !== undefined ? { tax_id: changes.taxId } : {}),
      })
      .where("id", "=", insurerId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toInsurer(row);
  }

  async updateStatus(trx: Kysely<Database>, insurerId: string, status: InsurerStatus): Promise<Insurer> {
    const row = await trx
      .updateTable("insurer_accounts")
      .set({ status, updated_at: sql`now()` })
      .where("id", "=", insurerId)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toInsurer(row);
  }
}

interface InsuranceAccountRow {
  id: string;
  insurer_id: string;
  email: string;
  password_hash: string;
  role: InsuranceAccountRole;
  status: InsuranceAccountStatus;
  created_by_platform_admin: string | null;
  suspended_at: Date | null;
  created_at: Date;
}

function accountToDomain(row: InsuranceAccountRow): InsuranceAccount {
  const account: InsuranceAccount = {
    id: row.id,
    insurerId: row.insurer_id,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    status: row.status,
    createdAt: row.created_at,
  };
  if (row.created_by_platform_admin) account.createdByPlatformAdmin = row.created_by_platform_admin;
  if (row.suspended_at) account.suspendedAt = row.suspended_at;
  return account;
}

export class KyselyInsuranceAccountRepository implements InsuranceAccountRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewInsuranceAccountRecord): Promise<InsuranceAccount> {
    const row = await trx
      .insertInto("insurance_accounts")
      .values({
        id: record.id,
        insurer_id: record.insurerId,
        email: record.email,
        password_hash: record.passwordHash,
        role: record.role,
        status: "ACTIVE",
        created_by_platform_admin: record.createdByPlatformAdmin ?? null,
        created_at: record.createdAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return accountToDomain(row);
  }

  async findById(trx: Kysely<Database>, id: string): Promise<InsuranceAccount | null> {
    const row = await trx.selectFrom("insurance_accounts").selectAll().where("id", "=", id).executeTakeFirst();
    return row ? accountToDomain(row) : null;
  }

  async findByEmail(trx: Kysely<Database>, email: string): Promise<InsuranceAccount | null> {
    const row = await trx.selectFrom("insurance_accounts").selectAll().where("email", "=", email).executeTakeFirst();
    return row ? accountToDomain(row) : null;
  }

  async findActiveAdminByInsurer(trx: Kysely<Database>, insurerId: string): Promise<InsuranceAccount | null> {
    const row = await trx
      .selectFrom("insurance_accounts")
      .selectAll()
      .where("insurer_id", "=", insurerId)
      .where("role", "=", "INSURANCE_ADMIN")
      .where("status", "=", "ACTIVE")
      .executeTakeFirst();
    return row ? accountToDomain(row) : null;
  }

  async resetCredentials(trx: Kysely<Database>, id: string, changes: InsuranceAccountCredentialsReset, now: Date): Promise<InsuranceAccount> {
    const row = await trx
      .updateTable("insurance_accounts")
      .set({ email: changes.email, password_hash: changes.passwordHash, updated_at: now })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return accountToDomain(row);
  }

  async updateStatus(trx: Kysely<Database>, id: string, status: InsuranceAccountStatus, now: Date): Promise<InsuranceAccount> {
    const row = await trx
      .updateTable("insurance_accounts")
      .set({ status, suspended_at: status === "SUSPENDED" ? now : null, updated_at: now })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return accountToDomain(row);
  }

  async listByInsurer(trx: Kysely<Database>, insurerId: string, role?: InsuranceAccountRole): Promise<InsuranceAccount[]> {
    let query = trx.selectFrom("insurance_accounts").selectAll().where("insurer_id", "=", insurerId);
    if (role) {
      query = query.where("role", "=", role);
    }
    const rows = await query.orderBy("created_at", "asc").execute();
    return rows.map(accountToDomain);
  }

  async delete(trx: Kysely<Database>, id: string): Promise<void> {
    await trx.deleteFrom("insurance_accounts").where("id", "=", id).execute();
  }
}

interface InsuranceSessionRow {
  id: string;
  insurance_account_id: string;
  refresh_token_hash: string;
  token_chain_id: string;
  user_agent: string | null;
  ip: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  last_used_at: Date;
  created_at: Date;
}

function sessionToDomain(row: InsuranceSessionRow): InsuranceSession {
  const session: InsuranceSession = {
    id: row.id,
    insuranceAccountId: row.insurance_account_id,
    refreshTokenHash: row.refresh_token_hash,
    tokenChainId: row.token_chain_id,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
  if (row.user_agent) session.userAgent = row.user_agent;
  if (row.ip) session.ip = row.ip;
  if (row.revoked_at) session.revokedAt = row.revoked_at;
  return session;
}

export class KyselyInsuranceSessionRepository implements InsuranceSessionRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewInsuranceSessionRecord): Promise<InsuranceSession> {
    const row = await trx
      .insertInto("insurance_sessions")
      .values({
        id: record.id,
        insurance_account_id: record.insuranceAccountId,
        refresh_token_hash: record.refreshTokenHash,
        token_chain_id: record.tokenChainId,
        user_agent: record.userAgent ?? null,
        ip: record.ip ?? null,
        expires_at: record.expiresAt,
        last_used_at: record.createdAt,
        created_at: record.createdAt,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return sessionToDomain(row);
  }

  async findByRefreshTokenHash(trx: Kysely<Database>, refreshTokenHash: string): Promise<InsuranceSession | null> {
    const row = await trx.selectFrom("insurance_sessions").selectAll().where("refresh_token_hash", "=", refreshTokenHash).executeTakeFirst();
    return row ? sessionToDomain(row) : null;
  }

  async revoke(trx: Kysely<Database>, id: string, revokedAt: Date): Promise<void> {
    await trx
      .updateTable("insurance_sessions")
      .set({ revoked_at: revokedAt, updated_at: sql`now()` })
      .where("id", "=", id)
      .where("revoked_at", "is", null)
      .execute();
  }

  async revokeChain(trx: Kysely<Database>, tokenChainId: string, revokedAt: Date): Promise<void> {
    await trx
      .updateTable("insurance_sessions")
      .set({ revoked_at: revokedAt, updated_at: sql`now()` })
      .where("token_chain_id", "=", tokenChainId)
      .where("revoked_at", "is", null)
      .execute();
  }

  async revokeAllForAccount(trx: Kysely<Database>, insuranceAccountId: string, revokedAt: Date): Promise<void> {
    await trx
      .updateTable("insurance_sessions")
      .set({ revoked_at: revokedAt, updated_at: sql`now()` })
      .where("insurance_account_id", "=", insuranceAccountId)
      .where("revoked_at", "is", null)
      .execute();
  }

  async revokeAllForInsurer(trx: Kysely<Database>, insurerId: string, revokedAt: Date): Promise<void> {
    await trx
      .updateTable("insurance_sessions")
      .set({ revoked_at: revokedAt, updated_at: sql`now()` })
      .where("insurance_account_id", "in", trx.selectFrom("insurance_accounts").select("id").where("insurer_id", "=", insurerId))
      .where("revoked_at", "is", null)
      .execute();
  }
}

// ---- Fase 4b: apólices e pedidos de reembolso ----

interface PolicyRow {
  id: string;
  family_id: string;
  member_id: string;
  insurer_id: string | null;
  insurer_name: string;
  policy_number: string;
  holder_name: string;
  /** `pg` devolve `date` como `Date` (hora local) por omissão; a Kysely tipa-o como `string`. */
  valid_until: string | Date | null;
  created_at: Date;
}

const POLICY_COLUMNS = ["id", "family_id", "member_id", "insurer_id", "insurer_name", "policy_number", "holder_name", "valid_until", "created_at"] as const;

function toPolicy(row: PolicyRow): InsurancePolicy {
  const policy: InsurancePolicy = {
    id: row.id,
    familyId: row.family_id,
    memberId: row.member_id,
    insurerName: row.insurer_name,
    policyNumber: row.policy_number,
    holderName: row.holder_name,
    createdAt: row.created_at,
  };
  if (row.insurer_id !== null) policy.insurerId = row.insurer_id;
  if (row.valid_until !== null) policy.validUntil = normalizeDate(row.valid_until);
  return policy;
}

function normalizeDate(value: string | Date): string {
  if (value instanceof Date) {
    return `${String(value.getFullYear()).padStart(4, "0")}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return value.slice(0, 10);
}

export class KyselyInsurancePoliciesRepository implements InsurancePoliciesRepository<Kysely<Database>> {
  async insert(trx: Kysely<Database>, record: NewInsurancePolicyRecord): Promise<InsurancePolicy> {
    const row = await trx
      .insertInto("insurance_policies")
      .values({
        id: record.id,
        family_id: record.familyId,
        member_id: record.memberId,
        insurer_id: record.insurerId ?? null,
        insurer_name: record.insurerName,
        policy_number: record.policyNumber,
        holder_name: record.holderName,
        valid_until: record.validUntil ?? null,
        created_by: record.createdBy,
        created_at: record.createdAt,
      })
      .returning(POLICY_COLUMNS)
      .executeTakeFirstOrThrow();
    return toPolicy(row);
  }

  async findById(trx: Kysely<Database>, familyId: string, memberId: string, policyId: string, lock = false): Promise<InsurancePolicy | null> {
    let query = trx.selectFrom("insurance_policies").select(POLICY_COLUMNS).where("family_id", "=", familyId).where("member_id", "=", memberId).where("id", "=", policyId);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    return row ? toPolicy(row) : null;
  }

  async listByMember(trx: Kysely<Database>, familyId: string, memberId: string): Promise<InsurancePolicy[]> {
    const rows = await trx
      .selectFrom("insurance_policies")
      .select(POLICY_COLUMNS)
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .orderBy("created_at", "desc")
      .orderBy("id", "asc")
      .execute();
    return rows.map(toPolicy);
  }

  async update(trx: Kysely<Database>, familyId: string, memberId: string, policyId: string, changes: InsurancePolicyChanges, now: Date): Promise<InsurancePolicy> {
    const row = await trx
      .updateTable("insurance_policies")
      .set({
        ...(changes.insurerId !== undefined ? { insurer_id: changes.insurerId } : {}),
        ...(changes.insurerName !== undefined ? { insurer_name: changes.insurerName } : {}),
        ...(changes.policyNumber !== undefined ? { policy_number: changes.policyNumber } : {}),
        ...(changes.holderName !== undefined ? { holder_name: changes.holderName } : {}),
        ...(changes.validUntil !== undefined ? { valid_until: changes.validUntil } : {}),
        updated_at: now,
      })
      .where("family_id", "=", familyId)
      .where("member_id", "=", memberId)
      .where("id", "=", policyId)
      .returning(POLICY_COLUMNS)
      .executeTakeFirstOrThrow();
    return toPolicy(row);
  }

  async delete(trx: Kysely<Database>, familyId: string, memberId: string, policyId: string): Promise<void> {
    await trx.deleteFrom("insurance_policies").where("family_id", "=", familyId).where("member_id", "=", memberId).where("id", "=", policyId).execute();
  }
}

interface ClaimRow {
  id: string;
  policy_id: string;
  insurer_id: string;
  amount: string;
  currency: string;
  status: ClaimStatus;
  decision_note: string | null;
  decided_by_insurance_account_id: string | null;
  decided_at: Date | null;
  created_at: Date;
}

const CLAIM_COLUMNS = ["id", "policy_id", "insurer_id", "amount", "currency", "status", "decision_note", "decided_by_insurance_account_id", "decided_at", "created_at"] as const;

function toClaim(row: ClaimRow, documentIds: string[], receiptIds: string[] = []): ReimbursementClaim {
  const claim: ReimbursementClaim = {
    id: row.id,
    policyId: row.policy_id,
    insurerId: row.insurer_id,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    documentIds,
    receiptIds,
    createdAt: row.created_at,
  };
  if (row.decision_note !== null) claim.decisionNote = row.decision_note;
  if (row.decided_by_insurance_account_id !== null) claim.decidedByInsuranceAccountId = row.decided_by_insurance_account_id;
  if (row.decided_at !== null) claim.decidedAt = row.decided_at;
  return claim;
}

export class KyselyReimbursementClaimsRepository implements ReimbursementClaimsRepository<Kysely<Database>> {
  /** Os `documentIds` de cada pedido vêm SÓ de `reimbursement_claim_documents` (BR-INS-04). */
  private async documentIdsByClaim(trx: Kysely<Database>, claimIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (claimIds.length === 0) return map;
    const rows = await trx.selectFrom("reimbursement_claim_documents").select(["claim_id", "document_id"]).where("claim_id", "in", claimIds).orderBy("document_id", "asc").execute();
    for (const row of rows) {
      map.set(row.claim_id, [...(map.get(row.claim_id) ?? []), row.document_id]);
    }
    return map;
  }

  /** BR-CLN-36: os `receiptIds` de cada pedido vêm SÓ de `reimbursement_claim_receipts`. */
  private async receiptIdsByClaim(trx: Kysely<Database>, claimIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (claimIds.length === 0) return map;
    const rows = await trx.selectFrom("reimbursement_claim_receipts").select(["claim_id", "receipt_id"]).where("claim_id", "in", claimIds).orderBy("receipt_id", "asc").execute();
    for (const row of rows) {
      map.set(row.claim_id, [...(map.get(row.claim_id) ?? []), row.receipt_id]);
    }
    return map;
  }

  private async hydrate(trx: Kysely<Database>, rows: ClaimRow[]): Promise<ReimbursementClaim[]> {
    const ids = rows.map((r) => r.id);
    const [docs, receipts] = await Promise.all([this.documentIdsByClaim(trx, ids), this.receiptIdsByClaim(trx, ids)]);
    return rows.map((row) => toClaim(row, docs.get(row.id) ?? [], receipts.get(row.id) ?? []));
  }

  async activeClaimIdsByReceipts(trx: Kysely<Database>, receiptIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (receiptIds.length === 0) return map;
    const rows = await trx
      .selectFrom("reimbursement_claim_receipts as r")
      .innerJoin("reimbursement_claims as c", "c.id", "r.claim_id")
      .select(["r.receipt_id", "r.claim_id"])
      .where("r.receipt_id", "in", receiptIds)
      .where("c.status", "in", ["SUBMITTED", "APPROVED", "PAID"])
      .execute();
    for (const row of rows) map.set(row.receipt_id, [...(map.get(row.receipt_id) ?? []), row.claim_id]);
    return map;
  }

  async insert(trx: Kysely<Database>, record: NewClaimRecord): Promise<ReimbursementClaim> {
    const row = await trx
      .insertInto("reimbursement_claims")
      .values({
        id: record.id,
        policy_id: record.policyId,
        insurer_id: record.insurerId,
        amount: record.amount,
        currency: record.currency,
        submitted_by: record.submittedBy,
        created_at: record.createdAt,
      })
      .returning(CLAIM_COLUMNS)
      .executeTakeFirstOrThrow();
    if (record.documentIds.length > 0) {
      await trx
        .insertInto("reimbursement_claim_documents")
        .values(record.documentIds.map((documentId) => ({ claim_id: record.id, document_id: documentId })))
        .execute();
    }
    if (record.receiptIds.length > 0) {
      await trx
        .insertInto("reimbursement_claim_receipts")
        .values(record.receiptIds.map((receiptId) => ({ claim_id: record.id, receipt_id: receiptId })))
        .execute();
    }
    const [claim] = await this.hydrate(trx, [row]);
    if (!claim) throw new Error("pedido inserido não encontrado");
    return claim;
  }

  async findForPolicy(trx: Kysely<Database>, policyId: string, claimId: string, lock = false): Promise<ReimbursementClaim | null> {
    let query = trx.selectFrom("reimbursement_claims").select(CLAIM_COLUMNS).where("policy_id", "=", policyId).where("id", "=", claimId);
    if (lock) query = query.forUpdate();
    const row = await query.executeTakeFirst();
    const [claim] = row ? await this.hydrate(trx, [row]) : [];
    return claim ?? null;
  }

  async listByPolicy(trx: Kysely<Database>, policyId: string): Promise<ReimbursementClaim[]> {
    const rows = await trx.selectFrom("reimbursement_claims").select(CLAIM_COLUMNS).where("policy_id", "=", policyId).orderBy("created_at", "desc").orderBy("id", "asc").execute();
    return this.hydrate(trx, rows);
  }

  async hasActiveForPolicy(trx: Kysely<Database>, policyId: string): Promise<boolean> {
    const row = await trx.selectFrom("reimbursement_claims").select("id").where("policy_id", "=", policyId).where("status", "in", ["SUBMITTED", "APPROVED"]).limit(1).executeTakeFirst();
    return row !== undefined;
  }

  async markPaid(trx: Kysely<Database>, claimId: string, now: Date): Promise<ReimbursementClaim> {
    const row = await trx.updateTable("reimbursement_claims").set({ status: "PAID", updated_at: now }).where("id", "=", claimId).where("status", "=", "APPROVED").returning(CLAIM_COLUMNS).executeTakeFirstOrThrow();
    const [claim] = await this.hydrate(trx, [row]);
    if (!claim) throw new Error("pedido atualizado não encontrado");
    return claim;
  }

  /** Junta SÓ `insurance_policies` (titular/nº da apólice, família/membro para auditoria) — nunca `documents`/perfil (BR-INS-04). */
  private portalQuery(trx: Kysely<Database>, insurerId: string) {
    return trx
      .selectFrom("reimbursement_claims as c")
      .innerJoin("insurance_policies as p", "p.id", "c.policy_id")
      .select([
        "c.id", "c.policy_id", "c.insurer_id", "c.amount", "c.currency", "c.status", "c.decision_note", "c.decided_by_insurance_account_id", "c.decided_at", "c.created_at",
        "p.holder_name", "p.policy_number", "p.family_id", "p.member_id",
      ])
      .where("c.insurer_id", "=", insurerId);
  }

  private async toPortal(trx: Kysely<Database>, rows: (ClaimRow & { holder_name: string; policy_number: string; family_id: string; member_id: string })[]): Promise<PortalClaim[]> {
    const ids = rows.map((r) => r.id);
    const [docs, receipts] = await Promise.all([this.documentIdsByClaim(trx, ids), this.receiptIdsByClaim(trx, ids)]);
    return rows.map((row) => ({
      claim: toClaim(row, docs.get(row.id) ?? [], receipts.get(row.id) ?? []),
      policyHolderName: row.holder_name,
      policyNumber: row.policy_number,
      familyId: row.family_id,
      memberId: row.member_id,
    }));
  }

  async listByInsurer(trx: Kysely<Database>, insurerId: string, status?: ClaimStatus): Promise<PortalClaim[]> {
    let query = this.portalQuery(trx, insurerId);
    if (status) query = query.where("c.status", "=", status);
    return this.toPortal(trx, await query.orderBy("c.created_at", "desc").orderBy("c.id", "asc").execute());
  }

  async findByInsurer(trx: Kysely<Database>, insurerId: string, claimId: string, lock = false): Promise<PortalClaim | null> {
    let query = this.portalQuery(trx, insurerId).where("c.id", "=", claimId);
    // `FOR UPDATE OF c`: bloqueia só o pedido (a apólice pode ser lida/editada pelo titular).
    if (lock) query = query.forUpdate("c");
    const row = await query.executeTakeFirst();
    const [portal] = row ? await this.toPortal(trx, [row]) : [];
    return portal ?? null;
  }

  async decide(trx: Kysely<Database>, claimId: string, decision: ClaimDecisionRecord): Promise<ReimbursementClaim> {
    const row = await trx
      .updateTable("reimbursement_claims")
      .set({ status: decision.status, decision_note: decision.note, decided_by_insurance_account_id: decision.insuranceAccountId, decided_at: decision.decidedAt, updated_at: decision.decidedAt })
      .where("id", "=", claimId)
      .where("status", "=", "SUBMITTED")
      .returning(CLAIM_COLUMNS)
      .executeTakeFirstOrThrow();
    const [claim] = await this.hydrate(trx, [row]);
    if (!claim) throw new Error("pedido atualizado não encontrado");
    return claim;
  }
}
