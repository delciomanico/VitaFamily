// Portas do módulo `professionals` (conventions.md §3.2): definidas aqui, implementadas em `infrastructure`. Genéricas em `Trx` para que
// esta camada nunca importe "kysely" (§3.9). Não há portas para `argon2`/`jose`/`node:crypto` (computação pura).
import type { Readable } from "node:stream";
import type { Clock } from "../../../platform/clock/index.js";
import type { Logger } from "../../../platform/logger/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { ProfessionalAccount, ProfessionalRef } from "../domain/account.js";
import type { OfferMethod, OfferPatchFields } from "../domain/offer.js";
import type { ProfilePatch } from "../domain/profile.js";
import type { CredentialKind, ScanStatus, SpecialtyCategory } from "../domain/requirements.js";
import type { ProfessionalValidationStatus, ValidationAction, ValidationActor } from "../domain/validation-status.js";
import type { ProfessionalSigningKey } from "../domain/jwt.js";
import type { ProfessionalInMemoryRateLimiter } from "../domain/rate-limiter.js";
import type { ProfessionalSession } from "../domain/session.js";

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface ProfessionalSentEmail {
  to: string;
  subject: string;
  text: string;
}

/** Envio de e-mail (SMTP na `infrastructure`, fake nos testes); falhas são «best effort» (send-mail.ts). */
export interface ProfessionalMailer {
  send(email: ProfessionalSentEmail): Promise<void>;
}

export interface NewProfessionalAccountRecord {
  id: string;
  professionalId: string;
  email: string;
  passwordHash: string;
  termsAcceptedVersion: string;
  createdAt: Date;
}

export type ProfessionalAuthTokenType = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export interface ProfessionalAuthToken {
  id: string;
  accountId: string;
  type: ProfessionalAuthTokenType;
  tokenHash: string;
  expiresAt: Date;
}

export interface NewProfessionalAuthTokenRecord {
  id: string;
  accountId: string;
  type: ProfessionalAuthTokenType;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface ProfessionalAccountRepository<Trx> {
  /** Cria a conta + o `Professional` em `DRAFT` (BR-MKT-14); `null` se o e-mail já existe (corrida incluída: `ON CONFLICT DO NOTHING`). */
  insertWithProfessional(trx: Trx, record: NewProfessionalAccountRecord): Promise<ProfessionalAccount | null>;
  findByEmail(trx: Trx, email: string): Promise<ProfessionalAccount | null>;
  findById(trx: Trx, id: string): Promise<ProfessionalAccount | null>;
  findProfessionalByAccountId(trx: Trx, accountId: string): Promise<ProfessionalRef | null>;
  markEmailVerified(trx: Trx, id: string, now: Date): Promise<void>;
  setPasswordHash(trx: Trx, id: string, passwordHash: string, now: Date): Promise<void>;
  touchLastLogin(trx: Trx, id: string, now: Date): Promise<void>;
}

export interface ProfessionalAuthTokenRepository<Trx> {
  insert(trx: Trx, record: NewProfessionalAuthTokenRecord): Promise<void>;
  /** Procura SEMPRE no âmbito da conta (o código só tem 10^6 valores). */
  findValidForAccount(trx: Trx, accountId: string, type: ProfessionalAuthTokenType, tokenHash: string, now: Date): Promise<ProfessionalAuthToken | null>;
  markUsed(trx: Trx, id: string, usedAt: Date): Promise<void>;
  invalidateAllForAccount(trx: Trx, accountId: string, type: ProfessionalAuthTokenType, now: Date): Promise<void>;
}

export interface NewProfessionalSessionRecord {
  id: string;
  accountId: string;
  refreshTokenHash: string;
  tokenChainId: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface ProfessionalSessionRepository<Trx> {
  insert(trx: Trx, record: NewProfessionalSessionRecord): Promise<ProfessionalSession>;
  findByRefreshTokenHash(trx: Trx, refreshTokenHash: string): Promise<ProfessionalSession | null>;
  /** `true` se a sessão estava ativa e foi revogada agora; `false` se já estava revogada (rotação concorrente/reutilização). */
  revoke(trx: Trx, id: string, revokedAt: Date): Promise<boolean>;
  revokeChain(trx: Trx, tokenChainId: string, revokedAt: Date): Promise<void>;
  revokeAllForAccount(trx: Trx, accountId: string, revokedAt: Date): Promise<void>;
}

/** Especialidade do catálogo (`specialties`); `professionalCount` = nº de ligações em `professional_specialties` (qualquer estado). */
export interface SpecialtyListRow {
  id: string;
  name: string;
  category: SpecialtyCategory;
  active: boolean;
  professionalCount: number;
}

export interface SpecialtyRecord {
  id: string;
  name: string;
  category: SpecialtyCategory;
  active: boolean;
}

export interface NewSpecialtyRecord {
  id: string;
  name: string;
  category: SpecialtyCategory;
  createdAt: Date;
}

export interface SpecialtyChanges {
  name?: string;
  category?: SpecialtyCategory;
  active?: boolean;
  updatedAt: Date;
}

export interface SpecialtyRepository<Trx> {
  /** Ordenadas por nome; `activeOnly` filtra as inativas. */
  list(trx: Trx, options: { activeOnly: boolean }): Promise<SpecialtyListRow[]>;
  /** `SELECT ... FOR UPDATE`: serializa alterações concorrentes da mesma especialidade (categoria vs. primeira ligação). */
  findByIdForUpdate(trx: Trx, id: string): Promise<SpecialtyRecord | null>;
  /** `null` se o nome (sem distinção de maiúsculas) já existe: `ON CONFLICT DO NOTHING` sobre `specialties_name_lower_uq`. */
  insert(trx: Trx, record: NewSpecialtyRecord): Promise<SpecialtyRecord | null>;
  update(trx: Trx, id: string, changes: SpecialtyChanges): Promise<void>;
  countProfessionals(trx: Trx, id: string): Promise<number>;
  /** Existe outra especialidade (diferente de `excludeId`) com o mesmo nome sem distinção de maiúsculas. */
  existsByNameLower(trx: Trx, name: string, excludeId?: string): Promise<boolean>;
}

/** Linha completa do profissional (perfil + estado de validação). */
export interface ProfessionalRecord {
  id: string;
  accountId: string;
  displayName: string | null;
  bio: string | null;
  city: string | null;
  paymentInstructions: string | null;
  validationStatus: ProfessionalValidationStatus;
  statusReason: string | null;
  statusChangedAt: Date;
  submittedAt: Date | null;
  approvedAt: Date | null;
  createdAt: Date;
}

export interface LinkedSpecialty {
  id: string;
  name: string;
  category: SpecialtyCategory;
  active: boolean;
}

export interface CredentialSummary {
  kind: CredentialKind;
  scanStatus: ScanStatus;
  /** `AAAA-MM-DD` ou `null`. */
  validUntil: string | null;
}

export interface StatusChange {
  validationStatus: ProfessionalValidationStatus;
  statusReason: string | null;
  statusChangedAt: Date;
  /** Preenchidos só nas transições que o exigem (submissão/aprovação). */
  submittedAt?: Date;
  approvedAt?: Date | null;
}

export interface ProfessionalProfileRepository<Trx> {
  /** Leitura sem bloqueio (GET /me). */
  findById(trx: Trx, professionalId: string): Promise<ProfessionalRecord | null>;
  /** `SELECT ... FOR UPDATE`: serializa escritas por profissional e decisões do admin; o estado lê-se SEMPRE daqui (BR-MKT-29). */
  findByIdForUpdate(trx: Trx, professionalId: string): Promise<ProfessionalRecord | null>;
  updateFields(trx: Trx, professionalId: string, changes: ProfilePatch, now: Date): Promise<void>;
  updateStatus(trx: Trx, professionalId: string, change: StatusChange, now: Date): Promise<void>;
  listSpecialties(trx: Trx, professionalId: string): Promise<LinkedSpecialty[]>;
  /** Especialidades pelos ids com `FOR SHARE` (uma desativação/alteração de categoria concorrente espera); devolve só as que existem. */
  lockSpecialtiesByIds(trx: Trx, ids: string[]): Promise<LinkedSpecialty[]>;
  /** Substitui o conjunto (apaga as que saem, insere as novas). */
  replaceSpecialties(trx: Trx, professionalId: string, specialtyIds: string[]): Promise<void>;
  /** Alguma das `specialtyIds` tem ofertas (qualquer estado) deste profissional? (a FK composta impede retirar a ligação). */
  hasOffersForSpecialties(trx: Trx, professionalId: string, specialtyIds: string[]): Promise<boolean>;
  listCredentialSummaries(trx: Trx, professionalId: string): Promise<CredentialSummary[]>;
  /** Ids por estado de validação (jobs diários), ordem estável. */
  listIdsByStatus(trx: Trx, status: ProfessionalValidationStatus): Promise<string[]>;
}

export interface NewValidationCase {
  id: string;
  professionalId: string;
  action: ValidationAction;
  fromStatus: ProfessionalValidationStatus;
  toStatus: ProfessionalValidationStatus;
  actor: ValidationActor;
  decidedBy?: string;
  reason: string | null;
  createdAt: Date;
}

export interface ValidationCaseRow {
  id: string;
  action: ValidationAction;
  fromStatus: ProfessionalValidationStatus;
  toStatus: ProfessionalValidationStatus;
  actor: ValidationActor;
  reason: string | null;
  createdAt: Date;
}

export interface ValidationCaseRepository<Trx> {
  insert(trx: Trx, record: NewValidationCase): Promise<void>;
  /** Mais recente primeiro. */
  listByProfessional(trx: Trx, professionalId: string): Promise<ValidationCaseRow[]>;
}

export interface AdminProfessionalFilter {
  status: ProfessionalValidationStatus;
  category?: SpecialtyCategory;
  q?: string;
  limit: number;
  /** Cursor opaco da página anterior (ordem: `submitted_at` ascendente, `id`). */
  after?: { submittedAtKey: string | null; id: string };
}

export interface AdminProfessionalItemRow {
  id: string;
  displayName: string | null;
  email: string;
  validationStatus: ProfessionalValidationStatus;
  submittedAt: Date | null;
  /** `submitted_at` em texto com microssegundos exatos (chave do cursor: `Date` só tem milissegundos). */
  submittedAtKey: string | null;
  credentialCount: number;
  createdAt: Date;
}

/** Fila do admin (BR-MKT-18): só identificação profissional; nunca `paymentInstructions`. */
export interface AdminProfessionalRepository<Trx> {
  list(trx: Trx, filter: AdminProfessionalFilter): Promise<AdminProfessionalItemRow[]>;
  /** Especialidades de vários profissionais de uma vez (evita N+1). */
  listSpecialtiesFor(trx: Trx, professionalIds: string[]): Promise<Map<string, LinkedSpecialty[]>>;
}

export interface PublicOffer {
  id: string;
  specialtyId: string;
  method: OfferMethod;
  durationMinutes: number;
  priceKz: number;
  note: string | null;
}

export interface PublicProfessionalRow {
  id: string;
  displayName: string;
  bio: string | null;
  city: string;
}

/** Identidade pública de um profissional que já tem conversas (MK2, BR-MKT-47): lida em QUALQUER estado, com o estado só como `approved`. */
export interface ConversationIdentityRow {
  id: string;
  displayName: string;
  city: string | null;
  approved: boolean;
}

export interface DirectoryFilter {
  category?: SpecialtyCategory;
  specialtyId?: string;
  city?: string;
  limit: number;
  afterId?: string;
}

/** Linha de `professionals` `APPROVED` para os factos de descoberta (MK2; só dados públicos + `approvedAt`). */
export interface ApprovedFactsRow extends PublicProfessionalRow {
  approvedAt: Date;
}

export interface FactsFilter {
  /** Só profissionais que têm esta especialidade ligada. */
  specialtyId?: string;
  /** Só profissionais com alguma especialidade desta categoria. */
  category?: SpecialtyCategory;
  /** Restringe a estes ids (`getApprovedFacts`). */
  ids?: string[];
  limit: number;
}

/** Estatística de horários futuros livres de uma oferta ativa (MK2; BR-MKT-37). */
export interface SlotStatRecord {
  offerId: string;
  nextSlotAt: Date | null;
  countNext14Days: number;
}

/** Leitor público (BR-MKT-19): TODAS as consultas filtram `validation_status = 'APPROVED'` (sem cache de estado) e só devolvem dados públicos. */
export interface DirectoryRepository<Trx> {
  findApproved(trx: Trx, professionalId: string): Promise<PublicProfessionalRow | null>;
  listApproved(trx: Trx, filter: DirectoryFilter): Promise<PublicProfessionalRow[]>;
  activeOffersFor(trx: Trx, professionalIds: string[]): Promise<Map<string, PublicOffer[]>>;
  /** MK2 (BR-MKT-41): e-mail da conta do profissional, SÓ para o aviso genérico de nova mensagem (nunca exposto em respostas); `null` se já não existe. */
  findNotificationEmail(trx: Trx, professionalId: string): Promise<string | null>;
  /** MK2 (BR-MKT-47): nome/cidade públicos e `approved` dos ids pedidos em qualquer estado (para o histórico de conversas), sem e-mail nem estado detalhado. */
  findConversationIdentities(trx: Trx, ids: string[]): Promise<ConversationIdentityRow[]>;
  /** MK2: linhas `APPROVED` (por id, ordem por id, teto `limit`) para os factos de descoberta; `APPROVED` filtrado em cada consulta. */
  listApprovedForFacts(trx: Trx, filter: FactsFilter): Promise<ApprovedFactsRow[]>;
  /** MK2: horários futuros livres de OFERTAS ATIVAS de profissionais `APPROVED`: o próximo e a contagem em `(now, now + 14 dias]`. */
  slotStatsFor(trx: Trx, professionalIds: string[], now: Date): Promise<Map<string, SlotStatRecord[]>>;
  /** Horários futuros livres (`starts_at > now`, em `[from, to)`) de um APPROVED, só de ofertas ativas. */
  bookableSlots(trx: Trx, professionalId: string, from: Date, to: Date, now: Date): Promise<SlotRecord[]>;
}

export interface MaintenanceRepository<Trx> {
  deleteExpiredAuthTokens(trx: Trx, before: Date): Promise<number>;
  deleteExpiredSessions(trx: Trx, before: Date): Promise<number>;
  /** Credenciais `PENDING` criadas antes de `before` (o antivírus não correu: fila perdida ou worker em baixo). */
  listStalePendingCredentialIds(trx: Trx, before: Date): Promise<string[]>;
}

/** Gancho de aprovação (BR-MKT-25): gera os horários das regras existentes na mesma transação; implementado na fatia S9. */
export interface ApprovalSlotGenerator<Trx> {
  generateForProfessional(trx: Trx, professionalId: string, now: Date): Promise<void>;
}

/** Credencial (metadados). `storageKey` é interna: nunca sai nas respostas. */
export interface CredentialRecord {
  id: string;
  professionalId: string;
  kind: CredentialKind;
  number: string | null;
  issuingBody: string | null;
  validUntil: string | null;
  storageKey: string;
  contentType: "application/pdf" | "image/jpeg" | "image/png";
  sizeBytes: number;
  scanStatus: ScanStatus;
  createdAt: Date;
}

export interface NewCredentialRecord {
  id: string;
  professionalId: string;
  kind: CredentialKind;
  number: string | null;
  issuingBody: string | null;
  validUntil: string | null;
  storageKey: string;
  contentType: CredentialRecord["contentType"];
  sizeBytes: number;
  createdAt: Date;
}

/** Isolamento: TODAS as leituras/escritas por credencial levam o `professionalId` (do token ou do caso de uso do admin). */
export interface CredentialRepository<Trx> {
  insert(trx: Trx, record: NewCredentialRecord): Promise<CredentialRecord>;
  listByProfessional(trx: Trx, professionalId: string): Promise<CredentialRecord[]>;
  countByProfessional(trx: Trx, professionalId: string): Promise<number>;
  findOwned(trx: Trx, professionalId: string, credentialId: string, options?: { forUpdate?: boolean }): Promise<CredentialRecord | null>;
  /** Só para o job de antivírus (sem dono): `FOR UPDATE`. */
  findByIdForScan(trx: Trx, credentialId: string): Promise<CredentialRecord | null>;
  delete(trx: Trx, professionalId: string, credentialId: string): Promise<void>;
  markClean(trx: Trx, credentialId: string, storageKey: string, now: Date): Promise<void>;
  markInfected(trx: Trx, credentialId: string, now: Date): Promise<void>;
}

/** Outbox própria de ficheiros (`professional_file_deletions`, OP-58): sobrevive à eliminação do profissional. */
export interface FileDeletionRepository<Trx> {
  enqueue(trx: Trx, storageKey: string): Promise<void>;
  listPending(trx: Trx, limit: number, maxAttempts: number): Promise<{ id: string; storageKey: string }[]>;
  markDeleted(trx: Trx, id: string, now: Date): Promise<void>;
  recordFailure(trx: Trx, id: string): Promise<void>;
}

/** Armazenamento dos ficheiros das credenciais (quarentena → final); implementada sobre `platform/storage`. */
export interface CredentialFileStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  copy(sourceKey: string, destKey: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Antivírus (ClamAV INSTREAM na `infrastructure`). */
export interface CredentialScanner {
  scan(buffer: Buffer): Promise<"CLEAN" | "INFECTED">;
}

/** Fila `professionals.scan-credential` (pg-boss na `infrastructure`). */
export interface CredentialScanQueue {
  enqueueScan(job: { credentialId: string }): Promise<void>;
}

export interface OfferRecord {
  id: string;
  professionalId: string;
  specialtyId: string;
  method: OfferMethod;
  durationMinutes: number;
  priceKz: number;
  note: string | null;
  active: boolean;
}

export interface NewOfferRecord {
  id: string;
  professionalId: string;
  specialtyId: string;
  method: OfferMethod;
  durationMinutes: number;
  priceKz: number;
  note: string | null;
  createdAt: Date;
}

/** Isolamento: toda a operação leva o `professionalId` do token. */
export interface OfferRepository<Trx> {
  /** `null` se a restrição de duplicado ativo (partial unique) é violada (`ON CONFLICT DO NOTHING`). */
  insert(trx: Trx, record: NewOfferRecord): Promise<OfferRecord | null>;
  /** Ordem: nome da especialidade, método, duração. */
  list(trx: Trx, professionalId: string, options: { active?: boolean }): Promise<OfferRecord[]>;
  findOwned(trx: Trx, professionalId: string, offerId: string, options?: { forUpdate?: boolean }): Promise<OfferRecord | null>;
  update(trx: Trx, offerId: string, changes: OfferPatchFields, now: Date): Promise<void>;
  countActive(trx: Trx, professionalId: string): Promise<number>;
  existsActiveDuplicate(trx: Trx, professionalId: string, key: { specialtyId: string; method: OfferMethod; durationMinutes: number }, excludeId?: string): Promise<boolean>;
}

export interface ScheduleRuleRecord {
  id: string;
  professionalId: string;
  offerId: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
}

export interface ScheduleRuleChanges {
  weekdays?: number[];
  startTime?: string;
  endTime?: string;
  validFrom?: string | null;
  validUntil?: string | null;
  active?: boolean;
}

/** Regra + dados da oferta de que depende a geração. */
export interface ScheduleRuleWithOffer extends ScheduleRuleRecord {
  offerActive: boolean;
  offerDurationMinutes: number;
}

export interface ScheduleRuleRepository<Trx> {
  insert(trx: Trx, record: ScheduleRuleRecord & { createdAt: Date }): Promise<ScheduleRuleRecord>;
  list(trx: Trx, professionalId: string, filter: { offerId?: string; active?: boolean }): Promise<ScheduleRuleRecord[]>;
  findOwned(trx: Trx, professionalId: string, ruleId: string, options?: { forUpdate?: boolean }): Promise<ScheduleRuleRecord | null>;
  update(trx: Trx, ruleId: string, changes: ScheduleRuleChanges, now: Date): Promise<void>;
  countActive(trx: Trx, professionalId: string): Promise<number>;
  /** Regras ativas do profissional (para a sobreposição, BR-MKT-25). */
  listActive(trx: Trx, professionalId: string, excludeRuleId?: string): Promise<ScheduleRuleRecord[]>;
  /** Regras (qualquer estado) com os dados da oferta, para gerar/reconciliar; `offerId`/`ruleId` restringem. */
  listWithOffer(trx: Trx, professionalId: string, filter: { offerId?: string; ruleId?: string }): Promise<ScheduleRuleWithOffer[]>;
  /** Profissionais `APPROVED` com pelo menos uma regra ativa (job diário). */
  listApprovedProfessionalIdsWithActiveRules(trx: Trx): Promise<string[]>;
}

export interface TimeOffRecord {
  id: string;
  professionalId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
}

export interface TimeOffRepository<Trx> {
  insert(trx: Trx, record: TimeOffRecord & { createdAt: Date }): Promise<TimeOffRecord>;
  /** Por omissão (sem `from`) só os que terminam depois de `now`. */
  list(trx: Trx, professionalId: string, filter: { from?: Date; to?: Date; endsAfter?: Date }): Promise<TimeOffRecord[]>;
  findOwned(trx: Trx, professionalId: string, id: string): Promise<TimeOffRecord | null>;
  delete(trx: Trx, professionalId: string, id: string): Promise<void>;
}

export interface SlotRecord {
  id: string;
  offerId: string;
  ruleId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface SlotRepository<Trx> {
  /** Horários que começam em `[from, to)`. */
  listInRange(trx: Trx, professionalId: string, from: Date, to: Date): Promise<SlotRecord[]>;
  /** Horários que terminam depois de `after` (futuros ou em curso), de qualquer regra. */
  listFuture(trx: Trx, professionalId: string, after: Date): Promise<SlotRecord[]>;
  /** Idempotente (`ON CONFLICT DO NOTHING`: também cobre a exclusão de sobreposição); devolve quantos criou. */
  insertMany(trx: Trx, professionalId: string, slots: { id: string; offerId: string; ruleId: string; startsAt: Date; endsAt: Date; createdAt: Date }[]): Promise<number>;
  deleteByIds(trx: Trx, professionalId: string, ids: string[]): Promise<number>;
  /** Remove os horários do profissional que intersectam `[from, to)` (bloqueio); devolve quantos. */
  deleteIntersecting(trx: Trx, professionalId: string, from: Date, to: Date): Promise<number>;
}

/** Efeitos de uma oferta nos horários gerados (BR-MKT-25): desativar remove os futuros livres; reativar repõe o que as regras prevêem. Fatia S9. */
export interface OfferSlotSync<Trx> {
  onActiveChanged(trx: Trx, professionalId: string, offerId: string, active: boolean, now: Date): Promise<void>;
}

/** Tudo o que os casos de uso precisam (ligado em `index.ts`); `db` é a ligação para leituras fora de transação. */
export interface ProfessionalsDeps<Trx> {
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
  logger: Logger;
  audit: AuditPort<Trx>;
  mailer: ProfessionalMailer;
  accountRepo: ProfessionalAccountRepository<Trx>;
  authTokenRepo: ProfessionalAuthTokenRepository<Trx>;
  sessionRepo: ProfessionalSessionRepository<Trx>;
  specialtyRepo: SpecialtyRepository<Trx>;
  profileRepo: ProfessionalProfileRepository<Trx>;
  validationCaseRepo: ValidationCaseRepository<Trx>;
  credentialRepo: CredentialRepository<Trx>;
  adminRepo: AdminProfessionalRepository<Trx>;
  offerRepo: OfferRepository<Trx>;
  offerSlotSync: OfferSlotSync<Trx>;
  scheduleRuleRepo: ScheduleRuleRepository<Trx>;
  timeOffRepo: TimeOffRepository<Trx>;
  slotRepo: SlotRepository<Trx>;
  directoryRepo: DirectoryRepository<Trx>;
  slotGenerator: ApprovalSlotGenerator<Trx>;
  fileDeletionRepo: FileDeletionRepository<Trx>;
  fileStore: CredentialFileStore;
  scanQueue: CredentialScanQueue;
  /** `UPLOAD_MAX_BYTES` (≤ 10 MB, BR-MKT-17). */
  maxFileSizeBytes: number;
  rateLimiter: ProfessionalInMemoryRateLimiter;
  signingKeys: ProfessionalSigningKey[];
  accessTtlSeconds: number;
  refreshTtlMs: number;
  appBaseUrl: string;
}
