// Portas do módulo `professionals` (conventions.md §3.2): definidas aqui, implementadas em `infrastructure`. Genéricas em `Trx` para que
// esta camada nunca importe "kysely" (§3.9). Não há portas para `argon2`/`jose`/`node:crypto` (computação pura).
import type { Clock } from "../../../platform/clock/index.js";
import type { Logger } from "../../../platform/logger/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { ProfessionalAccount, ProfessionalRef } from "../domain/account.js";
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

export interface ValidationCaseRepository<Trx> {
  insert(trx: Trx, record: NewValidationCase): Promise<void>;
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
  rateLimiter: ProfessionalInMemoryRateLimiter;
  signingKeys: ProfessionalSigningKey[];
  accessTtlSeconds: number;
  refreshTtlMs: number;
  appBaseUrl: string;
}
