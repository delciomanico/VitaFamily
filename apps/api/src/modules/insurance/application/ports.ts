// Portas do módulo `insurance` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure`. Genéricas em `Trx` para que esta camada nunca importe "kysely".
// Fase 4a: seguradoras (admin) + portal (auth, agentes). Fase 4b: apólices/pedidos (titular) e
// pedidos no portal (`access`/`documents` entram só como portas desta camada, modules.md §2).
import type { Clock } from "../../../platform/clock/index.js";
import type { Logger } from "../../../platform/logger/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Document, ResourceType } from "../../documents/index.js";
import type { ClaimReceiptRef, ClaimStatus, ReimbursementClaim } from "../domain/reimbursement-claim.js";
import type { InsurancePolicy } from "../domain/insurance-policy.js";
import type { InsuranceAccount, InsuranceAccountRole, InsuranceAccountStatus } from "../domain/insurance-account.js";
import type { InsuranceSigningKey } from "../domain/insurance-jwt.js";
import type { InsuranceInMemoryRateLimiter } from "../domain/insurance-rate-limiter.js";
import type { InsuranceSession } from "../domain/insurance-session.js";
import type { InsuranceTtlCache } from "../domain/insurance-ttl-cache.js";
import type { Insurer, InsurerStatus } from "../domain/insurer.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/** Ator do portal (`platform/actor.InsuranceActorInfo`) — só o que `application` precisa. */
export interface InsurancePortalActor {
  insuranceAccountId: string;
  insurerId: string;
  role: InsuranceAccountRole;
}

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface NewInsurerRecord {
  id: string;
  name: string;
  taxId: string;
  createdBy?: string;
  createdAt: Date;
}

export interface InsurerChanges {
  name?: string;
  taxId?: string;
}

/** `insurer_accounts` (schema.md §3b) — propriedade exclusiva deste módulo. */
export interface InsurersRepository<Trx> {
  insert(trx: Trx, record: NewInsurerRecord): Promise<Insurer>;
  findById(trx: Trx, insurerId: string): Promise<Insurer | null>;
  findByTaxId(trx: Trx, taxId: string): Promise<Insurer | null>;
  list(trx: Trx): Promise<Insurer[]>;
  /** BR-INS-09: só `ACTIVE`, por nome (`GET /families/{id}/insurers`). */
  listActive(trx: Trx): Promise<Insurer[]>;
  update(trx: Trx, insurerId: string, changes: InsurerChanges): Promise<Insurer>;
  updateStatus(trx: Trx, insurerId: string, status: InsurerStatus): Promise<Insurer>;
}

export interface NewInsuranceAccountRecord {
  id: string;
  insurerId: string;
  email: string;
  passwordHash: string;
  role: InsuranceAccountRole;
  createdByPlatformAdmin?: string;
  createdAt: Date;
}

export interface InsuranceAccountCredentialsReset {
  email: string;
  passwordHash: string;
}

/** `insurance_accounts` (schema.md §3b) — propriedade exclusiva deste módulo. */
export interface InsuranceAccountRepository<Trx> {
  insert(trx: Trx, record: NewInsuranceAccountRecord): Promise<InsuranceAccount>;
  findById(trx: Trx, id: string): Promise<InsuranceAccount | null>;
  findByEmail(trx: Trx, email: string): Promise<InsuranceAccount | null>;
  /** BR-INS-06: a única conta `INSURANCE_ADMIN` ativa de uma seguradora. */
  findActiveAdminByInsurer(trx: Trx, insurerId: string): Promise<InsuranceAccount | null>;
  /** `adminCreateOrResetInsurerRootAccount`: idempotente, nunca cria uma segunda conta. */
  resetCredentials(trx: Trx, id: string, changes: InsuranceAccountCredentialsReset, now: Date): Promise<InsuranceAccount>;
  updateStatus(trx: Trx, id: string, status: InsuranceAccountStatus, now: Date): Promise<InsuranceAccount>;
  listByInsurer(trx: Trx, insurerId: string, role?: InsuranceAccountRole): Promise<InsuranceAccount[]>;
  delete(trx: Trx, id: string): Promise<void>;
}

export interface NewInsuranceSessionRecord {
  id: string;
  insuranceAccountId: string;
  refreshTokenHash: string;
  tokenChainId: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  createdAt: Date;
}

/** `insurance_sessions` (schema.md §3b) — propriedade exclusiva deste módulo. */
export interface InsuranceSessionRepository<Trx> {
  insert(trx: Trx, record: NewInsuranceSessionRecord): Promise<InsuranceSession>;
  findByRefreshTokenHash(trx: Trx, refreshTokenHash: string): Promise<InsuranceSession | null>;
  revoke(trx: Trx, id: string, revokedAt: Date): Promise<void>;
  revokeChain(trx: Trx, tokenChainId: string, revokedAt: Date): Promise<void>;
  revokeAllForAccount(trx: Trx, insuranceAccountId: string, revokedAt: Date): Promise<void>;
  /** BR-INS-10: seguradora suspensa revoga as sessões de todas as suas contas. */
  revokeAllForInsurer(trx: Trx, insurerId: string, revokedAt: Date): Promise<void>;
}

export interface InsuranceSentEmail {
  to: string;
  subject: string;
  text: string;
}

/** Porta de e-mail própria do portal (ADR-021: não importa `auth`/`clinics`). */
export interface InsuranceMailer {
  send(email: InsuranceSentEmail): Promise<void>;
}

/** Estado resolvido por pedido (cache ≤60 s): papel/seguradora/suspensão (conta OU seguradora). */
export interface CachedInsuranceAccountState {
  insurerId: string;
  role: InsuranceAccountRole;
  suspended: boolean;
}

export interface InsuranceDeps<Trx> {
  insurersRepo: InsurersRepository<Trx>;
  insuranceAccountRepo: InsuranceAccountRepository<Trx>;
  insuranceSessionRepo: InsuranceSessionRepository<Trx>;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
  insuranceMailer: InsuranceMailer;
  logger: Logger;
  insuranceRateLimiter: InsuranceInMemoryRateLimiter;
  insuranceSigningKeys: InsuranceSigningKey[];
  insuranceAccessTtlSeconds: number;
  insuranceRefreshTtlMs: number;
  accountStateCache: InsuranceTtlCache<CachedInsuranceAccountState>;
}

// ---- Fase 4b: apólices e pedidos de reembolso (titular) ----

export interface NewInsurancePolicyRecord {
  id: string;
  familyId: string;
  memberId: string;
  insurerId?: string;
  insurerName: string;
  policyNumber: string;
  holderName: string;
  validUntil?: string;
  createdBy: string;
  createdAt: Date;
}

export interface InsurancePolicyChanges {
  insurerId?: string | null;
  insurerName?: string;
  policyNumber?: string;
  holderName?: string;
  validUntil?: string | null;
}

/** `insurance_policies` (schema.md §3) — propriedade exclusiva deste módulo; sempre com `familyId`+`memberId` (conventions.md §3.4). */
export interface InsurancePoliciesRepository<Trx> {
  insert(trx: Trx, record: NewInsurancePolicyRecord): Promise<InsurancePolicy>;
  /** `lock`: `SELECT … FOR UPDATE` (serializa criação de pedidos com edição/eliminação da apólice). */
  findById(trx: Trx, familyId: string, memberId: string, policyId: string, lock?: boolean): Promise<InsurancePolicy | null>;
  listByMember(trx: Trx, familyId: string, memberId: string): Promise<InsurancePolicy[]>;
  update(trx: Trx, familyId: string, memberId: string, policyId: string, changes: InsurancePolicyChanges, now: Date): Promise<InsurancePolicy>;
  delete(trx: Trx, familyId: string, memberId: string, policyId: string): Promise<void>;
}

export interface NewClaimRecord {
  id: string;
  policyId: string;
  insurerId: string;
  amount: number;
  currency: string;
  documentIds: string[];
  /** M14 R (BR-CLN-36). */
  receiptIds: string[];
  submittedBy: string;
  createdAt: Date;
}

/** Vista do pedido para o portal (BR-INS-04): o mínimo + `familyId`/`memberId` SÓ para auditoria (nunca sai no DTO). */
export interface PortalClaim {
  claim: ReimbursementClaim;
  policyHolderName: string;
  policyNumber: string;
  familyId: string;
  memberId: string;
}

export interface ClaimDecisionRecord {
  status: "APPROVED" | "REJECTED";
  note: string | null;
  insuranceAccountId: string;
  decidedAt: Date;
}

/** `reimbursement_claims` + `reimbursement_claim_documents` (schema.md §3) — propriedade exclusiva deste módulo. */
export interface ReimbursementClaimsRepository<Trx> {
  insert(trx: Trx, record: NewClaimRecord): Promise<ReimbursementClaim>;
  /** Titular: sempre dentro da apólice (já autorizada por família/membro). */
  findForPolicy(trx: Trx, policyId: string, claimId: string, lock?: boolean): Promise<ReimbursementClaim | null>;
  listByPolicy(trx: Trx, policyId: string): Promise<ReimbursementClaim[]>;
  hasActiveForPolicy(trx: Trx, policyId: string): Promise<boolean>;
  markPaid(trx: Trx, claimId: string, now: Date): Promise<ReimbursementClaim>;
  /** Portal: filtrado SEMPRE por `insurerId` (authorization.md §8.1 passo 2); outro ⇒ `null` (404). */
  listByInsurer(trx: Trx, insurerId: string, status?: ClaimStatus): Promise<PortalClaim[]>;
  findByInsurer(trx: Trx, insurerId: string, claimId: string, lock?: boolean): Promise<PortalClaim | null>;
  decide(trx: Trx, claimId: string, decision: ClaimDecisionRecord): Promise<ReimbursementClaim>;
  /** BR-CLN-36: pedidos `SUBMITTED`/`APPROVED`/`PAID` a que cada recibo está anexado (`REJECTED` liberta o recibo). */
  activeClaimIdsByReceipts(trx: Trx, receiptIds: string[]): Promise<Map<string, string[]>>;
}

/**
 * `ClinicReceiptLookup` (M14 R, BR-CLN-36, modules.md §2 nota 26): o que `insurance` pede a `clinic-receipts` — definida aqui,
 * implementada por `clinic-receipts/interface` e ligada em `main/api.ts` (`insurance` nunca importa `clinic-receipts`).
 */
export interface ClinicReceiptLookupPort<Trx> {
  /** Recibos visíveis ao membro (`clinic_receipt_links`), bloqueados (`FOR UPDATE`); ids não visíveis ficam de fora. */
  lockVisible(trx: Trx, familyId: string, memberId: string, receiptIds: string[]): Promise<{ id: string; number: number; status: "ISSUED" | "VOIDED"; totalMinor: number; currency: string }[]>;
  refs(trx: Trx, receiptIds: string[]): Promise<ClaimReceiptRef[]>;
  /** Resumo mínimo para a seguradora (BR-CLN-36): sem PDF, sem ids, sem profissional, sem método de pagamento. */
  summaries(trx: Trx, receiptIds: string[]): Promise<(InsuranceClaimReceiptSummary & { id: string })[]>;
}

export interface InsuranceClaimReceiptSummary {
  number: number;
  issuedAt: string;
  clinicName: string;
  lines: { description: string; amountMinor: number }[];
  totalMinor: number;
  currency: string;
  status: "ISSUED" | "VOIDED";
}

/** Subconjunto de `AccessPolicy<Trx>` que `insurance` chama pela raiz de `access` (modules.md §2). */
export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

/** `access.getMembershipFacts` (FAM_MEMBER em `GET /families/{id}/insurers`): `null` ⇒ não é membro. */
export interface MembershipPort<Trx> {
  getMembershipFacts(trx: Trx, familyId: string, userId: string): Promise<{ memberId: string } | null>;
}

/** Subconjunto da API pública de `documents` (modules.md §2): foto do cartão e anexos do pedido (BR-INS-04). */
export interface InsuranceDocumentsPort<Trx> {
  listForResource(trx: Trx, familyId: string, memberId: string, resourceType: ResourceType, resourceId: string): Promise<Document[]>;
  deleteAllForResource(trx: Trx, familyId: string, memberId: string, resourceType: ResourceType, resourceId: string): Promise<void>;
  listAttachable(trx: Trx, familyId: string, memberId: string, documentIds: string[]): Promise<Document[]>;
}

/** Dependências do lado do titular (`/families/.../insurance-policies`, `/families/{id}/insurers`). */
export interface InsuranceHolderDeps<Trx> {
  policiesRepo: InsurancePoliciesRepository<Trx>;
  claimsRepo: ReimbursementClaimsRepository<Trx>;
  insurersRepo: InsurersRepository<Trx>;
  policy: AccessPolicyPort<Trx>;
  membership: MembershipPort<Trx>;
  documents: InsuranceDocumentsPort<Trx>;
  /** M14 R (BR-CLN-36). */
  receipts: ClinicReceiptLookupPort<Trx>;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

/** Dependências do portal (`/insurance-portal/claims*`): sem `access`/`documents` (ADR-021). */
export interface InsurancePortalClaimsDeps<Trx> {
  claimsRepo: ReimbursementClaimsRepository<Trx>;
  /** M14 R (BR-CLN-36): resumo mínimo dos recibos anexados. */
  receipts: ClinicReceiptLookupPort<Trx>;
  audit: AuditPort<Trx>;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

export type { InsurancePolicy } from "../domain/insurance-policy.js";
export type { ClaimDecision, ClaimReceiptRef, ClaimStatus, ReimbursementClaim } from "../domain/reimbursement-claim.js";
export type { Insurer, InsurerStatus } from "../domain/insurer.js";
export type { InsuranceAccount, InsuranceAccountRole, InsuranceAccountStatus } from "../domain/insurance-account.js";
export type { InsuranceSession } from "../domain/insurance-session.js";
