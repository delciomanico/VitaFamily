// Fakes em memória das portas de `insurance` (mesmo padrão de `clinics/application/fixtures.ts`).
// Não é ficheiro de teste.
import type { Clock } from "../../../platform/clock/index.js";
import type { Logger } from "../../../platform/logger/index.js";
import { ForbiddenError } from "../../../platform/errors/index.js";
import type { AccessContext, CanInput, Relation } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Document, ResourceType } from "../../documents/index.js";
import type { InsurancePolicy } from "../domain/insurance-policy.js";
import type { ClaimStatus, ReimbursementClaim } from "../domain/reimbursement-claim.js";
import type { InsuranceAccount } from "../domain/insurance-account.js";
import { InsuranceInMemoryRateLimiter } from "../domain/insurance-rate-limiter.js";
import type { InsuranceSession } from "../domain/insurance-session.js";
import { InsuranceTtlCache } from "../domain/insurance-ttl-cache.js";
import type { Insurer, InsurerStatus } from "../domain/insurer.js";
import type {
  AccessPolicyPort,
  AuditPort,
  ClaimDecisionRecord,
  ClinicReceiptLookupPort,
  InsuranceDocumentsPort,
  InsuranceHolderDeps,
  InsurancePoliciesRepository,
  InsurancePolicyChanges,
  InsurancePortalClaimsDeps,
  MembershipPort,
  NewClaimRecord,
  NewInsurancePolicyRecord,
  PortalClaim,
  ReimbursementClaimsRepository,
  CachedInsuranceAccountState,
  InsuranceAccountCredentialsReset,
  InsuranceAccountRepository,
  InsuranceDeps,
  InsuranceMailer,
  InsuranceSentEmail,
  InsuranceSessionRepository,
  InsurerChanges,
  InsurersRepository,
  NewInsuranceAccountRecord,
  NewInsuranceSessionRecord,
  NewInsurerRecord,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];
  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export class FakeInsurersRepository implements InsurersRepository<FakeTrx> {
  readonly byId = new Map<string, Insurer>();

  async insert(_trx: FakeTrx, record: NewInsurerRecord): Promise<Insurer> {
    const insurer: Insurer = {
      id: record.id,
      name: record.name,
      taxId: record.taxId,
      status: "ACTIVE",
      createdAt: record.createdAt,
      ...(record.createdBy !== undefined ? { createdBy: record.createdBy } : {}),
    };
    this.byId.set(insurer.id, insurer);
    return Promise.resolve(insurer);
  }
  async findById(_trx: FakeTrx, id: string): Promise<Insurer | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }
  async findByTaxId(_trx: FakeTrx, taxId: string): Promise<Insurer | null> {
    return Promise.resolve([...this.byId.values()].find((i) => i.taxId === taxId) ?? null);
  }
  async list(): Promise<Insurer[]> {
    return Promise.resolve([...this.byId.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }
  async listActive(): Promise<Insurer[]> {
    return Promise.resolve([...this.byId.values()].filter((i) => i.status === "ACTIVE").sort((a, b) => a.name.localeCompare(b.name)));
  }
  async update(_trx: FakeTrx, id: string, changes: InsurerChanges): Promise<Insurer> {
    const updated = { ...this.require(id), ...changes };
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }
  async updateStatus(_trx: FakeTrx, id: string, status: InsurerStatus): Promise<Insurer> {
    const updated = { ...this.require(id), status };
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }
  seed(insurer: Insurer): void {
    this.byId.set(insurer.id, insurer);
  }
  /** Atalho de teste: muda o estado sem passar pelo caso de uso (nem sessões nem cache). */
  setStatus(id: string, status: InsurerStatus): void {
    this.byId.set(id, { ...this.require(id), status });
  }
  private require(id: string): Insurer {
    const insurer = this.byId.get(id);
    if (!insurer) throw new Error(`insurer ${id} inexistente`);
    return insurer;
  }
}

export class FakeInsuranceAccountRepository implements InsuranceAccountRepository<FakeTrx> {
  readonly byId = new Map<string, InsuranceAccount>();

  async insert(_trx: FakeTrx, record: NewInsuranceAccountRecord): Promise<InsuranceAccount> {
    const account: InsuranceAccount = {
      id: record.id,
      insurerId: record.insurerId,
      email: record.email,
      passwordHash: record.passwordHash,
      role: record.role,
      status: "ACTIVE",
      createdAt: record.createdAt,
      ...(record.createdByPlatformAdmin !== undefined ? { createdByPlatformAdmin: record.createdByPlatformAdmin } : {}),
    };
    this.byId.set(account.id, account);
    return Promise.resolve(account);
  }
  async findById(_trx: FakeTrx, id: string): Promise<InsuranceAccount | null> {
    return Promise.resolve(this.byId.get(id) ?? null);
  }
  async findByEmail(_trx: FakeTrx, email: string): Promise<InsuranceAccount | null> {
    return Promise.resolve([...this.byId.values()].find((a) => a.email === email) ?? null);
  }
  async findActiveAdminByInsurer(_trx: FakeTrx, insurerId: string): Promise<InsuranceAccount | null> {
    return Promise.resolve([...this.byId.values()].find((a) => a.insurerId === insurerId && a.role === "INSURANCE_ADMIN" && a.status === "ACTIVE") ?? null);
  }
  async resetCredentials(_trx: FakeTrx, id: string, changes: InsuranceAccountCredentialsReset): Promise<InsuranceAccount> {
    const account = this.byId.get(id);
    if (!account) throw new Error(`conta ${id} inexistente`);
    const updated = { ...account, email: changes.email, passwordHash: changes.passwordHash };
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }
  async updateStatus(_trx: FakeTrx, id: string, status: InsuranceAccount["status"], now: Date): Promise<InsuranceAccount> {
    const account = this.byId.get(id);
    if (!account) throw new Error(`conta ${id} inexistente`);
    const updated: InsuranceAccount = { ...account, status };
    if (status === "SUSPENDED") updated.suspendedAt = now;
    else delete updated.suspendedAt;
    this.byId.set(id, updated);
    return Promise.resolve(updated);
  }
  async listByInsurer(_trx: FakeTrx, insurerId: string, role?: InsuranceAccount["role"]): Promise<InsuranceAccount[]> {
    return Promise.resolve([...this.byId.values()].filter((a) => a.insurerId === insurerId && (!role || a.role === role)));
  }
  async delete(_trx: FakeTrx, id: string): Promise<void> {
    this.byId.delete(id);
    return Promise.resolve();
  }
  seed(account: InsuranceAccount): void {
    this.byId.set(account.id, account);
  }
  setStatus(id: string, status: InsuranceAccount["status"]): void {
    const account = this.byId.get(id);
    if (!account) throw new Error(`conta ${id} inexistente`);
    this.byId.set(id, { ...account, status });
  }
}

export class FakeInsuranceSessionRepository implements InsuranceSessionRepository<FakeTrx> {
  readonly sessions = new Map<string, InsuranceSession>();

  constructor(private readonly accounts: FakeInsuranceAccountRepository) {}

  async insert(_trx: FakeTrx, record: NewInsuranceSessionRecord): Promise<InsuranceSession> {
    const session: InsuranceSession = {
      id: record.id,
      insuranceAccountId: record.insuranceAccountId,
      refreshTokenHash: record.refreshTokenHash,
      tokenChainId: record.tokenChainId,
      expiresAt: record.expiresAt,
      lastUsedAt: record.createdAt,
      createdAt: record.createdAt,
    };
    this.sessions.set(session.id, session);
    return Promise.resolve(session);
  }
  async findByRefreshTokenHash(_trx: FakeTrx, hash: string): Promise<InsuranceSession | null> {
    return Promise.resolve([...this.sessions.values()].find((s) => s.refreshTokenHash === hash) ?? null);
  }
  async revoke(_trx: FakeTrx, id: string, revokedAt: Date): Promise<void> {
    this.revokeWhere((s) => s.id === id, revokedAt);
    return Promise.resolve();
  }
  async revokeChain(_trx: FakeTrx, chain: string, revokedAt: Date): Promise<void> {
    this.revokeWhere((s) => s.tokenChainId === chain, revokedAt);
    return Promise.resolve();
  }
  async revokeAllForAccount(_trx: FakeTrx, accountId: string, revokedAt: Date): Promise<void> {
    this.revokeWhere((s) => s.insuranceAccountId === accountId, revokedAt);
    return Promise.resolve();
  }
  async revokeAllForInsurer(_trx: FakeTrx, insurerId: string, revokedAt: Date): Promise<void> {
    this.revokeWhere((s) => this.accounts.byId.get(s.insuranceAccountId)?.insurerId === insurerId, revokedAt);
    return Promise.resolve();
  }
  firstId(): string {
    const [id] = [...this.sessions.keys()];
    if (id === undefined) throw new Error("sem sessões");
    return id;
  }
  private revokeWhere(pred: (s: InsuranceSession) => boolean, revokedAt: Date): void {
    for (const s of this.sessions.values()) if (pred(s) && !s.revokedAt) s.revokedAt = revokedAt;
  }
}

export class FakeInsuranceMailer implements InsuranceMailer {
  readonly sent: InsuranceSentEmail[] = [];
  failWith: Error | undefined;
  async send(email: InsuranceSentEmail): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push(email);
    return Promise.resolve();
  }
  lastSentTo(to: string): InsuranceSentEmail | undefined {
    return this.sent.filter((e) => e.to === to).at(-1);
  }
}

export class FakeInsuranceLogger {
  readonly warnings: { obj: unknown; msg: string }[] = [];
  warn(obj: unknown, msg: string): void {
    this.warnings.push({ obj, msg });
  }
}

// ---- Fase 4b: fakes do lado do titular e do portal de pedidos ----

/** Simula `AccessPolicy` para `MANAGE_INSURANCE`: SELF/TUTOR_OF permitem; OTHER/DEPENDENT_SELF negam. */
export class FakeInsuranceAccessPolicy implements AccessPolicyPort<FakeTrx> {
  readonly calls: CanInput[] = [];
  relation: Relation = "SELF";

  async can(_trx: FakeTrx, input: CanInput): Promise<AccessContext> {
    this.calls.push(input);
    if (this.relation === "OTHER" || this.relation === "DEPENDENT_SELF") {
      throw new ForbiddenError({ detail: "Sem permissão sobre os seguros deste membro." });
    }
    return Promise.resolve({
      actor: { id: "actor-1", familyId: input.familyId, name: "Actor", isDependent: false, status: "ACTIVE" },
      subject: { id: input.subjectMemberId ?? "subject-1", familyId: input.familyId, name: "Subject", isDependent: false, status: "ACTIVE" },
      relation: this.relation,
    });
  }
}

export class FakeMembershipPort implements MembershipPort<FakeTrx> {
  readonly members = new Set<string>();
  async getMembershipFacts(_trx: FakeTrx, familyId: string, userId: string): Promise<{ memberId: string } | null> {
    return Promise.resolve(this.members.has(`${familyId}:${userId}`) ? { memberId: "m" } : null);
  }
}

export class FakeInsurancePoliciesRepository implements InsurancePoliciesRepository<FakeTrx> {
  readonly byId = new Map<string, InsurancePolicy>();

  async insert(_trx: FakeTrx, record: NewInsurancePolicyRecord): Promise<InsurancePolicy> {
    const policy: InsurancePolicy = {
      id: record.id,
      familyId: record.familyId,
      memberId: record.memberId,
      insurerName: record.insurerName,
      policyNumber: record.policyNumber,
      holderName: record.holderName,
      createdAt: record.createdAt,
      ...(record.insurerId !== undefined ? { insurerId: record.insurerId } : {}),
      ...(record.validUntil !== undefined ? { validUntil: record.validUntil } : {}),
    };
    this.byId.set(policy.id, policy);
    return Promise.resolve(policy);
  }
  async findById(_trx: FakeTrx, familyId: string, memberId: string, policyId: string): Promise<InsurancePolicy | null> {
    const policy = this.byId.get(policyId);
    return Promise.resolve(policy?.familyId === familyId && policy.memberId === memberId ? policy : null);
  }
  async listByMember(_trx: FakeTrx, familyId: string, memberId: string): Promise<InsurancePolicy[]> {
    return Promise.resolve([...this.byId.values()].filter((p) => p.familyId === familyId && p.memberId === memberId));
  }
  async update(_trx: FakeTrx, familyId: string, memberId: string, policyId: string, changes: InsurancePolicyChanges): Promise<InsurancePolicy> {
    const current = await this.findById(_trx, familyId, memberId, policyId);
    if (!current) throw new Error("apólice inexistente no fake");
    const { insurerId, validUntil, ...rest } = changes;
    const updated: InsurancePolicy = { ...current, ...rest };
    if (insurerId === null) delete updated.insurerId;
    else if (insurerId !== undefined) updated.insurerId = insurerId;
    if (validUntil === null) delete updated.validUntil;
    else if (validUntil !== undefined) updated.validUntil = validUntil;
    this.byId.set(policyId, updated);
    return Promise.resolve(updated);
  }
  async delete(_trx: FakeTrx, _familyId: string, _memberId: string, policyId: string): Promise<void> {
    this.byId.delete(policyId);
    return Promise.resolve();
  }
  seed(policy: InsurancePolicy): void {
    this.byId.set(policy.id, policy);
  }
}

export class FakeReimbursementClaimsRepository implements ReimbursementClaimsRepository<FakeTrx> {
  readonly byId = new Map<string, ReimbursementClaim>();
  constructor(private readonly policies: FakeInsurancePoliciesRepository) {}

  async insert(_trx: FakeTrx, record: NewClaimRecord): Promise<ReimbursementClaim> {
    const claim: ReimbursementClaim = {
      id: record.id,
      policyId: record.policyId,
      insurerId: record.insurerId,
      amount: record.amount,
      currency: record.currency,
      status: "SUBMITTED",
      documentIds: record.documentIds,
      receiptIds: record.receiptIds,
      createdAt: record.createdAt,
    };
    this.byId.set(claim.id, claim);
    return Promise.resolve(claim);
  }
  async findForPolicy(_trx: FakeTrx, policyId: string, claimId: string): Promise<ReimbursementClaim | null> {
    const claim = this.byId.get(claimId);
    return Promise.resolve(claim?.policyId === policyId ? claim : null);
  }
  async listByPolicy(_trx: FakeTrx, policyId: string): Promise<ReimbursementClaim[]> {
    return Promise.resolve([...this.byId.values()].filter((c) => c.policyId === policyId));
  }
  async hasActiveForPolicy(_trx: FakeTrx, policyId: string): Promise<boolean> {
    return Promise.resolve([...this.byId.values()].some((c) => c.policyId === policyId && (c.status === "SUBMITTED" || c.status === "APPROVED")));
  }
  async markPaid(_trx: FakeTrx, claimId: string): Promise<ReimbursementClaim> {
    return Promise.resolve(this.patch(claimId, { status: "PAID" }));
  }
  async listByInsurer(_trx: FakeTrx, insurerId: string, status?: ClaimStatus): Promise<PortalClaim[]> {
    return Promise.resolve([...this.byId.values()].filter((c) => c.insurerId === insurerId && (!status || c.status === status)).flatMap((c) => this.portal(c)));
  }
  async findByInsurer(_trx: FakeTrx, insurerId: string, claimId: string): Promise<PortalClaim | null> {
    const claim = this.byId.get(claimId);
    return Promise.resolve(claim?.insurerId === insurerId ? (this.portal(claim)[0] ?? null) : null);
  }
  async decide(_trx: FakeTrx, claimId: string, decision: ClaimDecisionRecord): Promise<ReimbursementClaim> {
    return Promise.resolve(
      this.patch(claimId, {
        status: decision.status,
        ...(decision.note !== null ? { decisionNote: decision.note } : {}),
        decidedByInsuranceAccountId: decision.insuranceAccountId,
        decidedAt: decision.decidedAt,
      }),
    );
  }
  async activeClaimIdsByReceipts(_trx: FakeTrx, receiptIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    for (const claim of this.byId.values()) {
      if (claim.status === "REJECTED") continue;
      for (const id of claim.receiptIds ?? []) if (receiptIds.includes(id)) map.set(id, [...(map.get(id) ?? []), claim.id]);
    }
    return Promise.resolve(map);
  }
  seed(claim: ReimbursementClaim): void {
    this.byId.set(claim.id, claim);
  }
  private patch(claimId: string, changes: Partial<ReimbursementClaim>): ReimbursementClaim {
    const claim = this.byId.get(claimId);
    if (!claim) throw new Error("pedido inexistente no fake");
    const updated = { ...claim, ...changes };
    this.byId.set(claimId, updated);
    return updated;
  }
  private portal(claim: ReimbursementClaim): PortalClaim[] {
    const policy = this.policies.byId.get(claim.policyId);
    return policy ? [{ claim, policyHolderName: policy.holderName, policyNumber: policy.policyNumber, familyId: policy.familyId, memberId: policy.memberId }] : [];
  }
}

export class FakeInsuranceDocumentsPort implements InsuranceDocumentsPort<FakeTrx> {
  readonly documents = new Map<string, Document>();
  readonly deleted: { resourceType: ResourceType; resourceId: string }[] = [];

  async listForResource(_trx: FakeTrx, familyId: string, memberId: string, resourceType: ResourceType, resourceId: string): Promise<Document[]> {
    return Promise.resolve([...this.documents.values()].filter((d) => d.familyId === familyId && d.memberId === memberId && d.resourceType === resourceType && d.resourceId === resourceId));
  }
  async deleteAllForResource(_trx: FakeTrx, _familyId: string, _memberId: string, resourceType: ResourceType, resourceId: string): Promise<void> {
    this.deleted.push({ resourceType, resourceId });
    for (const [id, d] of this.documents) if (d.resourceType === resourceType && d.resourceId === resourceId) this.documents.delete(id);
    return Promise.resolve();
  }
  /** Mesma regra do `documents` real: do membro, CLEAN (a regra BR-CLN-08 testa-se em `documents`). */
  async listAttachable(_trx: FakeTrx, familyId: string, memberId: string, documentIds: string[]): Promise<Document[]> {
    return Promise.resolve([...this.documents.values()].filter((d) => d.familyId === familyId && d.memberId === memberId && d.scanStatus === "CLEAN" && documentIds.includes(d.id)));
  }
  seed(id: string, overrides: Partial<Document> = {}): Document {
    const document: Document = {
      id,
      familyId: "f1",
      memberId: "m1",
      resourceType: "EXAMINATION",
      resourceId: "exam-1",
      storageKey: `documents/${id}.pdf`,
      originalName: "fatura.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      checksumSha256: "abc",
      scanStatus: "CLEAN",
      uploadedByClinic: false,
      createdAt: new Date("2026-11-01T00:00:00Z"),
      ...overrides,
    };
    this.documents.set(id, document);
    return document;
  }
}

/** M14 R (BR-CLN-36): recibos preparados pelos testes; `visible` = visíveis ao membro. */
export class FakeClinicReceiptLookup implements ClinicReceiptLookupPort<FakeTrx> {
  readonly receipts = new Map<string, { id: string; number: number; status: "ISSUED" | "VOIDED"; totalMinor: number; currency: string; visible: boolean }>();

  async lockVisible(_trx: FakeTrx, _familyId: string, _memberId: string, receiptIds: string[]) {
    return Promise.resolve(receiptIds.flatMap((id) => (this.receipts.get(id)?.visible ? [this.receipts.get(id) as { id: string; number: number; status: "ISSUED" | "VOIDED"; totalMinor: number; currency: string }] : [])));
  }
  async refs(_trx: FakeTrx, receiptIds: string[]) {
    return Promise.resolve(receiptIds.flatMap((id) => { const r = this.receipts.get(id); return r ? [{ receiptId: r.id, number: r.number, status: r.status, totalMinor: r.totalMinor, currency: r.currency }] : []; }));
  }
  async summaries(_trx: FakeTrx, receiptIds: string[]) {
    return Promise.resolve(receiptIds.flatMap((id) => { const r = this.receipts.get(id); return r ? [{ id: r.id, number: r.number, issuedAt: "2026-01-01T00:00:00.000Z", clinicName: "Clínica Sol", lines: [{ description: "Consulta", amountMinor: r.totalMinor }], totalMinor: r.totalMinor, currency: r.currency, status: r.status }] : []; }));
  }
}

export interface InsuranceHolderFixtures {
  deps: InsuranceHolderDeps<FakeTrx>;
  portalDeps: InsurancePortalClaimsDeps<FakeTrx>;
  policiesRepo: FakeInsurancePoliciesRepository;
  claimsRepo: FakeReimbursementClaimsRepository;
  insurersRepo: FakeInsurersRepository;
  policy: FakeInsuranceAccessPolicy;
  membership: FakeMembershipPort;
  documents: FakeInsuranceDocumentsPort;
  receipts: FakeClinicReceiptLookup;
  audit: FakeAuditPort;
}

export function createInsuranceHolderFixtures(clock: Clock): InsuranceHolderFixtures {
  const policiesRepo = new FakeInsurancePoliciesRepository();
  const claimsRepo = new FakeReimbursementClaimsRepository(policiesRepo);
  const insurersRepo = new FakeInsurersRepository();
  const policy = new FakeInsuranceAccessPolicy();
  const membership = new FakeMembershipPort();
  const documents = new FakeInsuranceDocumentsPort();
  const receipts = new FakeClinicReceiptLookup();
  const audit = new FakeAuditPort();
  const deps: InsuranceHolderDeps<FakeTrx> = {
    policiesRepo,
    claimsRepo,
    insurersRepo,
    policy,
    membership,
    documents,
    receipts,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  const portalDeps: InsurancePortalClaimsDeps<FakeTrx> = { claimsRepo, receipts, audit, withTransaction: (fn) => fn(FAKE_TRX), clock };
  return { deps, portalDeps, policiesRepo, claimsRepo, insurersRepo, policy, membership, documents, receipts, audit };
}

export interface InsuranceFixtures {
  deps: InsuranceDeps<FakeTrx>;
  insurersRepo: FakeInsurersRepository;
  audit: FakeAuditPort;
  insuranceAccountRepo: FakeInsuranceAccountRepository;
  insuranceSessionRepo: FakeInsuranceSessionRepository;
  insuranceMailer: FakeInsuranceMailer;
  insuranceLogger: FakeInsuranceLogger;
}

export function createInsuranceFixtures(clock: Clock): InsuranceFixtures {
  const insurersRepo = new FakeInsurersRepository();
  const audit = new FakeAuditPort();
  const insuranceAccountRepo = new FakeInsuranceAccountRepository();
  const insuranceSessionRepo = new FakeInsuranceSessionRepository(insuranceAccountRepo);
  const insuranceMailer = new FakeInsuranceMailer();
  const insuranceLogger = new FakeInsuranceLogger();
  const deps: InsuranceDeps<FakeTrx> = {
    insurersRepo,
    insuranceAccountRepo,
    insuranceSessionRepo,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
    insuranceMailer,
    logger: insuranceLogger as unknown as Logger,
    insuranceRateLimiter: new InsuranceInMemoryRateLimiter(clock),
    insuranceSigningKeys: [{ kid: "test", secret: new TextEncoder().encode("a".repeat(32)) }],
    insuranceAccessTtlSeconds: 900,
    insuranceRefreshTtlMs: 30 * 24 * 60 * 60 * 1000,
    accountStateCache: new InsuranceTtlCache<CachedInsuranceAccountState>(clock, 60_000),
  };
  return { deps, insurersRepo, audit, insuranceAccountRepo, insuranceSessionRepo, insuranceMailer, insuranceLogger };
}
