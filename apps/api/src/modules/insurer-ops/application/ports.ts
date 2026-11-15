// Portas do módulo `insurer-ops` (conventions.md §3.2): definidas aqui, implementadas em `infrastructure`; genéricas em
// `Trx` para que esta camada nunca importe "kysely". Dados da seguradora: todas as consultas exigem `insurerId` (BR-SEG-14:
// não existe consulta «por id» sem seguradora; recurso de outra seguradora ⇒ `null` ⇒ `NOT_FOUND`).
import type { Readable } from "node:stream";
import type { Clock } from "../../../platform/clock/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Beneficiary, BeneficiaryPatch, BeneficiaryRelationship, BeneficiaryStatus } from "../domain/beneficiary.js";
import type { Company, CompanyPatch, CompanyStatus } from "../domain/company.js";
import type { ImportBatch, ImportReport, ImportStatus } from "../domain/import-batch.js";
import type { ImportFormat, ImportRow } from "../domain/import-file.js";
import type { LinkRequest, LinkRequestStatus, LinkRequestTarget } from "../domain/link-request.js";
import type { CoverageRowForEligibility } from "../domain/eligibility.js";
import type { InsurerPlan, ParsedCoverage, PlanCoverage } from "../domain/plan.js";
import type { PlanStatus, Policy, PolicyPatch, PolicyStatus } from "../domain/policy.js";
import type { InsurerProvider, ProviderStatus } from "../domain/provider.js";
import type { PolicySettingDefinition, StoredPolicySetting } from "../domain/policy-setting.js";
import type { InsurerService, ServicePatch, ServiceStatus } from "../domain/service.js";
import type { CatalogTypes, ServiceKind, ServiceKindInput, ServiceKindPatch } from "../domain/service-kind.js";
import type { InMemoryRateLimiter } from "../domain/rate-limiter.js";
import type { Authorization, AuthorizationAttachment, AuthorizationEvent, AuthorizationListStatus, AuthorizationRow, ClosedReason, AttachmentKind } from "../domain/authorization.js";
import type { AuthorizationStatus } from "../domain/authorization-machine.js";
import type { AutoApprovalRule, AutoApprovalTrace } from "../domain/auto-approval.js";
import type { AuthorizationDecider } from "../domain/authorization-actions.js";
import type { InsurerAuthorizationEventRow, InsurerAuthorizationRow, InsurerQueueFilter, QueueCursor, SlaMetricsCounts } from "../domain/insurer-authorization.js";
import type { CoverageFact } from "../domain/coverage-phase.js";
import type { CoverageLine } from "../domain/coverage.js";

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}
export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

/** `insurer_accounts` lido pela raiz de `insurance` (modules.md §2 nota 23d) — nunca a tabela diretamente. */
export interface InsurerSettingsPort<Trx> {
  get(trx: Trx, insurerId: string): Promise<{ name: string; operationalModuleEnabled: boolean; currency: string; status: "ACTIVE" | "SUSPENDED" } | null>;
}

/** Paginação por conjunto de chaves (`createdAt`+`id`, mais recentes primeiro); o repositório devolve até `limit + 1` linhas. */
export interface PageQuery {
  limit: number;
  cursor?: { createdAt: string; id: string };
}

export interface CompaniesRepository<Trx> {
  insert(trx: Trx, record: { id: string; insurerId: string; name: string; taxId: string; createdAt: Date }): Promise<Company>;
  findById(trx: Trx, insurerId: string, id: string): Promise<Company | null>;
  findByTaxId(trx: Trx, insurerId: string, taxId: string): Promise<Company | null>;
  /** NIF das empresas existentes (importação). */
  findTaxIds(trx: Trx, insurerId: string, taxIds: string[]): Promise<string[]>;
  /** Mapa NIF → id (importação). */
  idsByTaxId(trx: Trx, insurerId: string, taxIds: string[]): Promise<Map<string, string>>;
  list(trx: Trx, insurerId: string, filter: { status?: CompanyStatus }, page: PageQuery): Promise<Company[]>;
  update(trx: Trx, insurerId: string, id: string, patch: CompanyPatch, now: Date): Promise<Company>;
}

export interface NewBeneficiaryRecord {
  id: string;
  insurerId: string;
  companyId: string | null;
  holderId: string | null;
  name: string;
  idDocumentType: string;
  idDocumentNumber: string;
  birthDate: string;
  relationship: BeneficiaryRelationship;
  cardNumber: string;
  createdAt: Date;
}

export interface BeneficiaryFilter {
  q?: string;
  status?: BeneficiaryStatus;
  companyId?: string;
  holderId?: string;
  relationship?: BeneficiaryRelationship;
}

export interface BeneficiariesRepository<Trx> {
  insert(trx: Trx, record: NewBeneficiaryRecord): Promise<Beneficiary>;
  /** Inserção em lote da importação (transação única; um conflito de unicidade aborta tudo ⇒ `ConflictError`). */
  insertMany(trx: Trx, records: NewBeneficiaryRecord[]): Promise<void>;
  findById(trx: Trx, insurerId: string, id: string, lock?: boolean): Promise<Beneficiary | null>;
  findByDocument(trx: Trx, insurerId: string, type: string, number: string): Promise<Beneficiary | null>;
  list(trx: Trx, insurerId: string, filter: BeneficiaryFilter, page: PageQuery): Promise<Beneficiary[]>;
  update(trx: Trx, insurerId: string, id: string, patch: BeneficiaryPatch, now: Date): Promise<Beneficiary>;
  setStatus(trx: Trx, insurerId: string, id: string, status: BeneficiaryStatus, note: string | null, now: Date): Promise<Beneficiary>;
  setClaimCode(trx: Trx, insurerId: string, id: string, claim: { hash: string; expiresAt: Date }, now: Date): Promise<void>;
  /** `TIPO|número` já existentes (importação). */
  existingDocumentKeys(trx: Trx, insurerId: string, numbers: string[]): Promise<Set<string>>;
  /** Nº de documento → nº de titulares existentes com esse número (importação). */
  holderCountsByNumber(trx: Trx, insurerId: string, numbers: string[]): Promise<Map<string, number>>;
  /** Nº de documento → id do titular existente (só quando é único). */
  holderIdsByNumber(trx: Trx, insurerId: string, numbers: string[]): Promise<Map<string, string>>;
  existingCardNumbers(trx: Trx, insurerId: string, cardNumbers: string[]): Promise<Set<string>>;
  /** Liga ao paciente (BR-SEG-20; FK composta `family_members`): falha com `ConflictError` se já ligado/duplicado. */
  link(trx: Trx, insurerId: string, id: string, target: LinkRequestTarget, now: Date): Promise<void>;
  hasAny(trx: Trx, insurerId: string): Promise<boolean>;
}

export interface LinkRequestsRepository<Trx> {
  list(trx: Trx, insurerId: string, filter: { status: LinkRequestStatus }, page: PageQuery): Promise<LinkRequest[]>;
  findById(trx: Trx, insurerId: string, id: string, lock?: boolean): Promise<{ request: LinkRequest; target: LinkRequestTarget } | null>;
  decide(trx: Trx, insurerId: string, id: string, decision: { status: "CONFIRMED" | "REJECTED"; note: string | null; accountId: string; decidedAt: Date }): Promise<LinkRequest>;
}

export interface PlanRef {
  id: string;
  status: PlanStatus;
}

export interface NewPolicyRecord {
  id: string;
  insurerId: string;
  planId: string;
  companyId: string | null;
  holderId: string;
  number: string;
  validFrom: string;
  validTo: string;
  createdAt: Date;
}

export interface PoliciesRepository<Trx> {
  insert(trx: Trx, record: NewPolicyRecord): Promise<Policy>;
  findById(trx: Trx, insurerId: string, id: string, lock?: boolean): Promise<Policy | null>;
  list(trx: Trx, insurerId: string, filter: { status?: PolicyStatus; companyId?: string; holderId?: string; q?: string }, page: PageQuery): Promise<Policy[]>;
  update(trx: Trx, insurerId: string, id: string, patch: PolicyPatch, now: Date): Promise<Policy>;
  setStatus(trx: Trx, insurerId: string, id: string, status: PolicyStatus, note: string | null, now: Date): Promise<Policy>;
  /** O plano (alvo da FK composta) da própria seguradora; outra seguradora ⇒ `null`. */
  findPlan(trx: Trx, insurerId: string, planId: string): Promise<PlanRef | null>;
  /** Job `insurer.expire-policies`: `ACTIVE` com `validTo < today` ⇒ `EXPIRED`; devolve a contagem por seguradora. Idempotente. */
  expireDue(trx: Trx, today: string, now: Date): Promise<{ insurerId: string; count: number }[]>;
  hasAny(trx: Trx, insurerId: string): Promise<boolean>;
}

export interface ImportsRepository<Trx> {
  insert(trx: Trx, record: { id: string; insurerId: string; format: ImportFormat; rowCount: number; report: ImportReport; rows: ImportRow[]; createdBy: string; createdAt: Date }): Promise<ImportBatch>;
  findById(trx: Trx, insurerId: string, id: string, lock?: boolean): Promise<ImportBatch | null>;
  /** Fecha o lote (`COMMITTED`/`CANCELLED`): atualiza estado e relatório e descarta as linhas. */
  close(trx: Trx, insurerId: string, id: string, status: Extract<ImportStatus, "COMMITTED" | "CANCELLED">, report: ImportReport, now: Date): Promise<ImportBatch>;
  /** Job: lotes `PREVIEW` criados antes de `olderThan` passam a `CANCELLED` e perdem as linhas (dados pessoais); contagem por seguradora. Idempotente. */
  expireStalePreviews(trx: Trx, olderThan: Date, now: Date): Promise<{ insurerId: string; count: number }[]>;
}

export interface ServicesRepository<Trx> {
  /** Código duplicado na seguradora ⇒ `ConflictError`. */
  insert(trx: Trx, record: { id: string; insurerId: string; code: string; name: string; category: string | null; createdAt: Date }): Promise<InsurerService>;
  findById(trx: Trx, insurerId: string, id: string): Promise<InsurerService | null>;
  list(trx: Trx, insurerId: string, filter: { q?: string; status?: ServiceStatus }, page: PageQuery): Promise<InsurerService[]>;
  update(trx: Trx, insurerId: string, id: string, patch: ServicePatch, now: Date): Promise<InsurerService>;
  /** Quantos dos ids pertencem à seguradora (validação das coberturas). */
  countByIds(trx: Trx, insurerId: string, ids: string[]): Promise<number>;
  /** BR-SEG-39 (`classify`): todos os serviços da seguradora com categoria e tipo atual (a normalização é do domínio). */
  listForClassification(trx: Trx, insurerId: string): Promise<{ id: string; category: string | null; serviceKindId: string | null }[]>;
  setServiceKind(trx: Trx, insurerId: string, ids: string[], serviceKindId: string, now: Date): Promise<void>;
}

/** `insurer_service_kinds` (BR-SEG-39). */
export interface ServiceKindsRepository<Trx> {
  count(trx: Trx, insurerId: string): Promise<number>;
  /** Os tipos por omissão (um por `expense_types` ativo); idempotente. */
  seedDefaults(trx: Trx, insurerId: string): Promise<void>;
  list(trx: Trx, insurerId: string, filter: { status?: ServiceStatus }): Promise<ServiceKind[]>;
  findById(trx: Trx, insurerId: string, id: string, lock?: boolean): Promise<ServiceKind | null>;
  /** `code` duplicado na seguradora ⇒ `ConflictError`. */
  insert(trx: Trx, record: ServiceKindInput & { id: string; insurerId: string; createdAt: Date }): Promise<ServiceKind>;
  update(trx: Trx, insurerId: string, id: string, patch: ServiceKindPatch, now: Date): Promise<ServiceKind>;
  countActiveServices(trx: Trx, insurerId: string, id: string): Promise<number>;
}

/** Catálogos globais do Vita (`guide_types`, `expense_types`): só leitura; um tipo novo é uma linha de dados. */
export interface CatalogTypesRepository<Trx> {
  list(trx: Trx): Promise<CatalogTypes>;
}

/** `policy_setting_definitions` (globais) + `insurer_policy_settings` (BR-SEG-40). */
export interface PolicySettingsRepository<Trx> {
  definitions(trx: Trx): Promise<PolicySettingDefinition[]>;
  list(trx: Trx, insurerId: string): Promise<StoredPolicySetting[]>;
  /** Upsert; devolve o valor gravado antes (ou `null`). `serviceId` já validado como da seguradora. */
  upsert(trx: Trx, record: { insurerId: string; key: string; serviceId: string | null; value: number; accountId: string; now: Date }): Promise<{ previous: number | null }>;
  /** Apaga a definição; devolve o valor apagado (ou `null` se não existia). */
  remove(trx: Trx, insurerId: string, key: string, serviceId: string | null): Promise<number | null>;
}

export interface PlansRepository<Trx> {
  /** Nome duplicado na versão 1 ⇒ `ConflictError`. */
  insert(trx: Trx, record: { id: string; insurerId: string; name: string; createdAt: Date }): Promise<InsurerPlan>;
  findById(trx: Trx, insurerId: string, id: string, lock?: boolean): Promise<InsurerPlan | null>;
  list(trx: Trx, insurerId: string, filter: { status?: PlanStatus; name?: string }, page: PageQuery): Promise<InsurerPlan[]>;
  setStatus(trx: Trx, insurerId: string, id: string, status: PlanStatus, now: Date): Promise<InsurerPlan>;
  /** Maior `version` com este nome na seguradora. */
  maxVersion(trx: Trx, insurerId: string, name: string): Promise<number>;
  /** Existe versão `DRAFT` com este nome? */
  hasDraft(trx: Trx, insurerId: string, name: string): Promise<boolean>;
  /** Cria a versão seguinte (DRAFT) copiando as coberturas da origem; DRAFT duplicado (corrida) ⇒ `ConflictError`. */
  insertNewVersion(trx: Trx, record: { id: string; insurerId: string; sourcePlanId: string; name: string; version: number; createdAt: Date }): Promise<InsurerPlan>;
  listCoverages(trx: Trx, insurerId: string, planId: string): Promise<PlanCoverage[]>;
  /** Substitui o conjunto inteiro (apaga e insere) na transação do chamador. */
  replaceCoverages(trx: Trx, insurerId: string, planId: string, items: ParsedCoverage[], now: Date): Promise<void>;
}

export interface ProvidersRepository<Trx> {
  /** Clínica já ligada à seguradora ⇒ `ConflictError`. */
  insert(trx: Trx, record: { id: string; insurerId: string; clinicId: string; name: string; createdAt: Date }): Promise<InsurerProvider>;
  findById(trx: Trx, insurerId: string, id: string, lock?: boolean): Promise<InsurerProvider | null>;
  list(trx: Trx, insurerId: string, filter: { status?: ProviderStatus }, page: PageQuery): Promise<InsurerProvider[]>;
  setStatus(trx: Trx, insurerId: string, id: string, status: ProviderStatus, now: Date): Promise<InsurerProvider>;
  /** §8.4: ids das seguradoras com ligação ATIVA a esta clínica (o módulo/estado da seguradora vê-se por `InsurerSettingsPort`). */
  activeInsurerIdsOfClinic(trx: Trx, clinicId: string): Promise<string[]>;
  isActivelyLinked(trx: Trx, clinicId: string, insurerId: string): Promise<boolean>;
}

/** Candidato à elegibilidade: beneficiário + a apólice vigente do agregado (titular e dependentes partilham a do titular). */
export interface EligibilityCandidate {
  beneficiaryId: string;
  name: string;
  cardNumber: string;
  status: string;
  cardVersion: number;
  /** Apólice `ACTIVE` e vigente hoje do titular do agregado; `null` se não houver. */
  policy: { planId: string; planName: string; number: string; status: string; validFrom: string; validTo: string } | null;
}

export type EligibilityLookup = { kind: "CARD"; cardNumber: string } | { kind: "DOCUMENT"; type: string; number: string } | { kind: "ID"; beneficiaryId: string };

export interface EligibilityRepository<Trx> {
  find(trx: Trx, insurerId: string, lookup: EligibilityLookup, today: string): Promise<EligibilityCandidate | null>;
  /** Coberturas não `EXCLUDED` do plano, de serviços `ACTIVE`; `serviceCode` opcional filtra. */
  coverages(trx: Trx, insurerId: string, planId: string, serviceCode: string | null): Promise<(CoverageRowForEligibility & { serviceId: string })[]>;
  /** O código existe na lista (ativa) da seguradora? (só para decidir se vai para a auditoria). */
  serviceCodeExists(trx: Trx, insurerId: string, code: string): Promise<boolean>;
}

/** Lista de clínicas parceiras de `clinics` (modules.md §2 nota 23b), ligada em `main/api.ts`: só `PARTNER` e `ACTIVE`. */
export interface PartnerClinicDirectory<Trx> {
  /** Ordenado por nome de apresentação (`display_name` ?? `name`) e `id`; devolve até `limit + 1`. */
  list(trx: Trx, query: { q?: string; limit: number; after?: { name: string; id: string } }): Promise<{ id: string; name: string }[]>;
  find(trx: Trx, clinicId: string): Promise<{ id: string; name: string } | null>;
}

/** Pedido de ligação visto pelo paciente (`InsuranceCardClaim`): sem dados da seguradora além do que o próprio pediu. */
export interface PatientLinkRequest {
  id: string;
  insurerId: string;
  /** Só preenchido com a ligação confirmada (`CONFIRMED`). */
  beneficiaryId: string | null;
  status: LinkRequestStatus;
  createdAt: Date;
  decidedAt: Date | null;
  decisionNote: string | null;
}

/** Cartões/pedidos do paciente (S6 parcial, BR-SEG-20): sempre por `(familyId, memberId)` — nunca consulta «só por id». */
export interface PatientInsuranceRepository<Trx> {
  /**
   * Candidato à reclamação: beneficiário da seguradora, não ligado nem cancelado, com o código (HMAC) ainda válido e cuja
   * apólice (do titular do agregado) tem este número. Bloqueia a linha (`FOR UPDATE`). Uma única consulta para todos os
   * motivos de recusa (BR-SEG-20, anti-enumeração).
   */
  findClaimCandidate(trx: Trx, insurerId: string, policyNumber: string, codeHash: string, now: Date): Promise<{ beneficiaryId: string } | null>;
  /** Uso único: apaga o código do beneficiário. */
  consumeClaimCode(trx: Trx, insurerId: string, beneficiaryId: string, now: Date): Promise<void>;
  /** O membro já tem pedido `PENDING` ou ligação confirmada nesta seguradora? */
  hasPendingOrLinked(trx: Trx, insurerId: string, familyId: string, memberId: string): Promise<boolean>;
  insertRequest(trx: Trx, record: { id: string; insurerId: string; beneficiaryId: string; requestedBy: string; familyId: string; memberId: string; createdAt: Date }): Promise<void>;
  listRequests(trx: Trx, familyId: string, memberId: string): Promise<PatientLinkRequest[]>;
  findRequest(trx: Trx, familyId: string, memberId: string, requestId: string, lock?: boolean): Promise<PatientLinkRequest | null>;
  /** `CONFIRMED → REVOKED`: desfaz a ligação do beneficiário (mantém-no) e incrementa `card_version` (invalida os QR emitidos). */
  revoke(trx: Trx, record: { insurerId: string; requestId: string; beneficiaryId: string; familyId: string; memberId: string; now: Date }): Promise<void>;
  /** Beneficiários ligados ao membro (`insurerId` e `beneficiaryId`; uma seguradora por linha). */
  listLinked(trx: Trx, familyId: string, memberId: string): Promise<{ insurerId: string; beneficiaryId: string }[]>;
  findLinked(trx: Trx, familyId: string, memberId: string, beneficiaryId: string): Promise<{ insurerId: string; beneficiaryId: string } | null>;
}

/** Ator do app: utilizador autenticado (`getActor()`); a decisão de acesso é de `access.AccessPolicy` (§8.5). */
export interface PatientActor {
  userId: string;
  platformAdmin: boolean;
}

/**
 * `AccessPolicy.can(MANAGE_INSURANCE)` por porta (authorization.md §8.5; ligada em `main/api.ts` sobre `access.policy`):
 * só `SELF` (adulto) ou `TUTOR_OF`. Recusas ⇒ `ForbiddenError`/`NotFoundError` (o caso de uso traduz tudo em `NOT_FOUND`).
 */
export interface PatientAccessPort<Trx> {
  authorize(trx: Trx, input: { actor: PatientActor; familyId: string; memberId: string }): Promise<{ relation: string }>;
}

/** Pedido a gravar (já validado; estado inicial `IN_REVIEW` com os dois eventos, BR-AUT-02/06). */
export interface NewAuthorizationRecord extends Omit<Authorization, "createdAt" | "updatedAt" | "closedReason" | "authorizedAmount" | "code" | "validUntil" | "decisionNote" | "decidedAt" | "infoExpiresAt" | "status"> {
  /** `IN_REVIEW`, ou `APPROVED` quando a auto-aprovação se aplica (BR-AUT-03; a transição é registada nos eventos). */
  status: "IN_REVIEW" | "APPROVED";
  /** Só com `status=APPROVED`: aprovação automática (`decidedBy=SYSTEM`, `authorizedAmount=requestedAmount`). */
  autoApproval?: { authorizedAmount: number; code: string; validUntil: Date };
  /** Rasto da avaliação de auto-aprovação (nulo nos recursos). */
  autoApprovalTrace: AutoApprovalTrace | null;
  submittedByClinicAccountId: string;
  now: Date;
}

export interface AuthorizationStatusChange {
  status: AuthorizationStatus;
  closedReason: ClosedReason | null;
  /** Prazo recalculado: limpa também a marca de escalada (BR-AUT-20). */
  decisionDueAt?: Date;
  /** `null` limpa o limite (fora de `INFO_REQUESTED`, CHECK da BD). */
  infoExpiresAt: Date | null;
  now: Date;
}

export interface NewAuthorizationEvent {
  insurerId: string;
  authorizationId: string;
  from: AuthorizationStatus | null;
  to: AuthorizationStatus;
  actorType: AuthorizationEvent["actorType"];
  actorAccountId: string | null;
  /** Só `PORTAL` nesta fatia (marco B §7.5). */
  channel: "PORTAL";
  note: string | null;
  /** Fatia 4: decisor e nota INTERNA (só seguradora; nunca devolvida à clínica). */
  actorRole?: "ANALYST" | "SUPERVISOR";
  internalNote?: string | null;
  at: Date;
}

export interface NewAttachmentRecord {
  id: string;
  insurerId: string;
  authorizationId: string;
  kind: AttachmentKind;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  uploadedByClinicAccountId: string;
  createdAt: Date;
}

export interface AuthorizationListFilter {
  insurerId?: string;
  status?: AuthorizationListStatus;
  processId?: string;
}

/**
 * `insurer_authorizations` + eventos + anexos (schema.md §3c). As leituras da clínica filtram por `insurer_providers.clinic_id`
 * (o pedido é da clínica do token; outro caso ⇒ `null` ⇒ `NOT_FOUND`).
 */
export interface AuthorizationsRepository<Trx> {
  /** Beneficiário ligado a um membro (BR-SEG-20): quem o tem; `null` se não ligado. */
  linkOfBeneficiary(trx: Trx, insurerId: string, beneficiaryId: string): Promise<{ familyId: string; memberId: string } | null>;
  /** Ligação ATIVA da clínica à seguradora: id do `Provider` (o prestador do pedido). */
  activeProviderId(trx: Trx, clinicId: string, insurerId: string): Promise<string | null>;
  /** Serviço da seguradora por código (qualquer estado) com o tipo de guia do `service_kind`; `null` se não existe. */
  findServiceByCode(trx: Trx, insurerId: string, code: string): Promise<{ id: string; status: "ACTIVE" | "INACTIVE"; guideType: string | null; serviceKindId: string | null } | null>;
  /** Linhas do plano (incl. `EXCLUDED`) para `evaluateCoverage`. */
  planCoverageLines(trx: Trx, insurerId: string, planId: string): Promise<CoverageLine[]>;
  /** Tipos de guia ativos (dados, `guide_types`). */
  activeGuideTypes(trx: Trx): Promise<string[]>;
  /** Duplicado em curso (UNIQUE parcial) ou recurso já vivo ⇒ `ConflictError`. */
  insert(trx: Trx, record: NewAuthorizationRecord): Promise<void>;
  insertEvent(trx: Trx, event: NewAuthorizationEvent): Promise<void>;
  /** Pedido da clínica (por prestador), com `FOR UPDATE` se `lock`. */
  findForClinic(trx: Trx, clinicId: string, id: string, lock?: boolean): Promise<AuthorizationRow | null>;
  /** Mais recentes primeiro; até `limit + 1` linhas. */
  listForClinic(trx: Trx, clinicId: string, filter: AuthorizationListFilter, page: PageQuery): Promise<AuthorizationRow[]>;
  updateStatus(trx: Trx, insurerId: string, id: string, change: AuthorizationStatusChange): Promise<void>;
  events(trx: Trx, authorizationIds: string[]): Promise<Map<string, AuthorizationEvent[]>>;
  attachments(trx: Trx, authorizationIds: string[]): Promise<Map<string, AuthorizationAttachment[]>>;
  countAttachments(trx: Trx, insurerId: string, authorizationId: string): Promise<number>;
  insertAttachment(trx: Trx, record: NewAttachmentRecord): Promise<AuthorizationAttachment>;
  findAttachment(trx: Trx, insurerId: string, authorizationId: string, attachmentId: string): Promise<(AuthorizationAttachment & { storageKey: string }) | null>;
  deleteAttachment(trx: Trx, insurerId: string, attachmentId: string): Promise<void>;
  /** Job: `INFO_REQUESTED` com `info_expires_at <= now`, com bloqueio (`FOR UPDATE SKIP LOCKED`). */
  lockExpiredInfoRequests(trx: Trx, now: Date, limit: number): Promise<{ id: string; insurerId: string }[]>;
  /** `ProcessFacts.getCoverageFacts`: factos por processo, em lote (projeção pura de `coverage-phase.ts`). */
  coverageFacts(trx: Trx, processIds: string[], now: Date): Promise<{ processId: string; fact: CoverageFact }[]>;
}

/** Decisão gravada sobre um pedido `IN_REVIEW` (UPDATE condicionado ao estado: a decisão perdida devolve `false`). */
export type DecisionWrite =
  | { kind: "APPROVE"; authorizedAmount: number; code: string; validUntil: Date; note: string | null; decidedBy: Extract<AuthorizationDecider, "ANALYST" | "SUPERVISOR">; accountId: string; now: Date }
  | { kind: "REJECT"; note: string; decidedBy: Extract<AuthorizationDecider, "ANALYST" | "SUPERVISOR">; accountId: string; now: Date }
  | { kind: "REQUEST_INFO"; note: string; infoExpiresAt: Date; accountId: string; now: Date }
  | { kind: "REVERT"; note: string; now: Date }
  | { kind: "REOPEN"; decisionDueAt: Date; now: Date };

export interface QueuePage {
  limit: number;
  cursor?: QueueCursor;
}

/** Contas ATIVAS com papel `AUTHORIZATION_ANALYST` da seguradora (o selector de «atribuir»). */
export interface AuthorizationAssignee {
  id: string;
  email: string;
}

/**
 * Lado da SEGURADORA do pedido (fatia 4, ADR-035): fila, detalhe, decisão, atribuição, métricas e job de SLA. Todas as consultas
 * filtram por `insurerId` (BR-SEG-14): pedido/anexo/conta de outra seguradora ⇒ `null`/`false` ⇒ `NOT_FOUND`.
 */
export interface InsurerAuthorizationsRepository<Trx> {
  /** Fila ordenada (por prazo ou recente); até `limit + 1` linhas. `SUBMITTED` nunca aparece. */
  list(trx: Trx, insurerId: string, filter: InsurerQueueFilter, page: QueuePage): Promise<InsurerAuthorizationRow[]>;
  /** Pedido da seguradora, com `FOR UPDATE` se `lock`. */
  find(trx: Trx, insurerId: string, id: string, lock?: boolean): Promise<InsurerAuthorizationRow | null>;
  events(trx: Trx, insurerId: string, authorizationId: string): Promise<InsurerAuthorizationEventRow[]>;
  /** Escreve a decisão; `false` se o pedido já não estava no estado esperado (corrida perdida ⇒ `409`). Limpa/define as marcas. */
  decide(trx: Trx, insurerId: string, id: string, from: AuthorizationStatus, write: DecisionWrite): Promise<boolean>;
  /** Atribuição (marca, não estado; auditada): `null` liberta. O pedido está bloqueado (`find(…, lock)`) na transação do chamador. */
  assign(trx: Trx, insurerId: string, id: string, accountId: string | null, now: Date): Promise<void>;
  /** Conta ATIVA com papel `AUTHORIZATION_ANALYST` da seguradora? */
  isActiveAnalyst(trx: Trx, insurerId: string, accountId: string): Promise<boolean>;
  listAssignees(trx: Trx, insurerId: string): Promise<AuthorizationAssignee[]>;
  metrics(trx: Trx, insurerId: string, period: { from: Date; to: Date }, now: Date): Promise<SlaMetricsCounts>;
  /** Job: `IN_REVIEW` com prazo atingido e sem marca, com bloqueio (`FOR UPDATE SKIP LOCKED`). */
  lockSlaBreaches(trx: Trx, now: Date, limit: number): Promise<{ id: string; insurerId: string }[]>;
  markEscalated(trx: Trx, insurerId: string, id: string, now: Date): Promise<void>;
}

/** `insurer_auto_approval_rules` (BR-AUT-23). */
export interface AutoApprovalRuleRecord extends AutoApprovalRule {
  targetName: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutoApprovalRulesRepository<Trx> {
  /** Ativas, para `podeAutoAprovar` na criação do pedido. */
  listActive(trx: Trx, insurerId: string): Promise<AutoApprovalRule[]>;
  /** Ordem: ativas primeiro, depois nome (até 100 por seguradora). */
  list(trx: Trx, insurerId: string): Promise<AutoApprovalRuleRecord[]>;
  count(trx: Trx, insurerId: string): Promise<number>;
  find(trx: Trx, insurerId: string, id: string): Promise<AutoApprovalRuleRecord | null>;
  /** UNIQUE parcial «uma ativa por alvo» ⇒ `ConflictError`; alvo de outra seguradora (FK composta) ⇒ `ConflictError`. */
  insert(trx: Trx, record: { id: string; insurerId: string; name: string; serviceKindId: string | null; serviceId: string | null; maxAmount: number; active: boolean; accountId: string; now: Date }): Promise<void>;
  update(trx: Trx, insurerId: string, id: string, patch: { name?: string; maxAmount?: number; active?: boolean }, accountId: string, now: Date): Promise<void>;
  /** `true` se apagou. */
  remove(trx: Trx, insurerId: string, id: string): Promise<boolean>;
}

/** Quem abre o processo (audit.md §3): a conta de clínica que submete o pedido. */
export interface ProcessOpener {
  actorType: "CLINIC_ACCOUNT";
  actorClinicAccountId: string;
  requestId: string;
  ip?: string;
  userAgent?: string;
}

/**
 * `ProcessLinker` (ADR-034, modules.md nota 31): definida AQUI, implementada por `processes` e ligada em `main/api.ts`;
 * `insurer-ops` e `processes` não se importam. Corre na transação do pedido (se falha, não há pedido).
 */
export interface ProcessLinker<Trx> {
  /** Idempotente por `(originType, originId)`; `originId` = id do 1.º pedido da cadeia. */
  open(trx: Trx, input: { familyId: string; memberId: string; originType: "AUTHORIZATION"; originId: string; clinicId: string; by: ProcessOpener }): Promise<{ processId: string }>;
  /** Só leitura: o processo é da clínica? (valida o `processId` do pedido). */
  findForClinic(trx: Trx, input: { clinicId: string; processId: string }): Promise<{ processId: string; familyId: string; memberId: string } | null>;
}

/**
 * Ficheiros dos anexos (BR-AUT-13; modules.md nota 31d): `Storage` + antivírus + outbox `file_deletions`, ligados em `main/api.ts`.
 * `insurer-ops` não usa `documents`.
 */
export interface AttachmentFiles<Trx> {
  /** Antivírus síncrono ANTES de gravar; indisponível ⇒ lança (⇒ 503). */
  scan(buffer: Buffer): Promise<"CLEAN" | "INFECTED">;
  put(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  /** Fatia 4: descarga em stream (o módulo não importa `node:stream` tipos de I/O além do tipo `Readable`); a interface faz o pipe. */
  get(key: string): Promise<Readable>;
  /** Apaga o ficheiro pelo outbox (`file_deletions`), na transação do chamador. */
  scheduleDelete(trx: Trx, key: string): Promise<void>;
}

/** Dependências comuns a todos os casos de uso do portal. */
export interface OpsDeps<Trx> {
  insurers: InsurerSettingsPort<Trx>;
  companies: CompaniesRepository<Trx>;
  beneficiaries: BeneficiariesRepository<Trx>;
  linkRequests: LinkRequestsRepository<Trx>;
  policies: PoliciesRepository<Trx>;
  imports: ImportsRepository<Trx>;
  services: ServicesRepository<Trx>;
  serviceKinds: ServiceKindsRepository<Trx>;
  catalogTypes: CatalogTypesRepository<Trx>;
  policySettings: PolicySettingsRepository<Trx>;
  plans: PlansRepository<Trx>;
  providers: ProvidersRepository<Trx>;
  eligibility: EligibilityRepository<Trx>;
  authorizations: AuthorizationsRepository<Trx>;
  insurerAuthorizations: InsurerAuthorizationsRepository<Trx>;
  autoApprovalRules: AutoApprovalRulesRepository<Trx>;
  processes: ProcessLinker<Trx>;
  files: AttachmentFiles<Trx>;
  partnerClinics: PartnerClinicDirectory<Trx>;
  patients: PatientInsuranceRepository<Trx>;
  patientAccess: PatientAccessPort<Trx>;
  /** Rate limit em memória da elegibilidade (BR-SEG-18). */
  rateLimiter: InMemoryRateLimiter;
  audit: AuditPort<Trx>;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
  /** Segredo do HMAC dos códigos de reclamação (BR-SEG-20). */
  claimCodeSecret: string;
}

export type { Beneficiary, Company, ImportBatch, LinkRequest, Policy };
