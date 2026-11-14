// Portas do módulo `insurer-ops` (conventions.md §3.2): definidas aqui, implementadas em `infrastructure`; genéricas em
// `Trx` para que esta camada nunca importe "kysely". Dados da seguradora: todas as consultas exigem `insurerId` (BR-SEG-14:
// não existe consulta «por id» sem seguradora; recurso de outra seguradora ⇒ `null` ⇒ `NOT_FOUND`).
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
