// Portas do módulo `clinics` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir da API pública de `access`
// (modules.md §2: `clinics` depende só de `access`). Genéricas em `Trx` para que esta camada
// nunca importe "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { Logger } from "../../../platform/logger/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Clinic, ClinicStatus, ClinicType } from "../domain/clinic.js";
import type { ClinicAccount, ClinicAccountRole, ClinicAccountStatus } from "../domain/clinic-account.js";
import type { ClinicSigningKey } from "../domain/clinic-jwt.js";
import type { ClinicInMemoryRateLimiter } from "../domain/clinic-rate-limiter.js";
import type { ClinicSession } from "../domain/clinic-session.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/**
 * Subconjunto de `AccessModule` que `clinics` consome pela raiz (modules.md §2, nota 11): só
 * `getMembershipFacts` (estrutura, não categoria de dados de saúde — `authorization.md` §4).
 */
export interface MembershipFacts {
  memberId: string;
  role?: "FAMILY_ADMIN" | "FAMILY_MEMBER";
  isAdult: boolean;
  status: "ACTIVE" | "BLOCKED";
}

export interface AccessPort<Trx> {
  getMembershipFacts(trx: Trx, familyId: string, userId: string): Promise<MembershipFacts | null>;
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

export interface NewClinicRecord {
  id: string;
  type: ClinicType;
  familyId?: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  createdBy?: string;
  createdAt: Date;
}

export interface ClinicChanges {
  name?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ClinicListFilter {
  status?: ClinicStatus;
}

/** `clinics` (schema.md §3) — propriedade exclusiva deste módulo (conventions.md §3.5). */
export interface ClinicsRepository<Trx> {
  insert(trx: Trx, record: NewClinicRecord): Promise<Clinic>;
  /** Procura global por id (clínicas parceiras não têm família); quem chama confirma `type`/`familyId`. */
  findById(trx: Trx, clinicId: string): Promise<Clinic | null>;
  /** Parceiras (todas) + privadas de `familyId` (UC-CLN-02). */
  listVisibleToFamily(trx: Trx, familyId: string, filter: ClinicListFilter): Promise<Clinic[]>;
  /** Só parceiras (UC-ADM-03/admin). */
  listPartners(trx: Trx, filter: ClinicListFilter): Promise<Clinic[]>;
  countPrivateByFamily(trx: Trx, familyId: string): Promise<number>;
  update(trx: Trx, clinicId: string, changes: ClinicChanges): Promise<Clinic>;
  updateStatus(trx: Trx, clinicId: string, status: ClinicStatus): Promise<Clinic>;
  delete(trx: Trx, clinicId: string): Promise<void>;
}

// --- Portal da clínica (D17/D18, ADR-020): identidade `ClinicAccount`/`clinic_sessions`, SEM
// nenhuma ligação a `users`/`families` — por isso estas portas não aparecem em `AccessPort`.

export interface NewClinicAccountRecord {
  id: string;
  clinicId: string;
  email: string;
  passwordHash: string;
  role: ClinicAccountRole;
  createdByPlatformAdmin?: string;
  createdAt: Date;
}

export interface ClinicAccountCredentialsReset {
  email: string;
  passwordHash: string;
}

/** `clinic_accounts` (schema.md §1) — propriedade exclusiva deste módulo. */
export interface ClinicAccountRepository<Trx> {
  insert(trx: Trx, record: NewClinicAccountRecord): Promise<ClinicAccount>;
  findById(trx: Trx, id: string): Promise<ClinicAccount | null>;
  findByEmail(trx: Trx, email: string): Promise<ClinicAccount | null>;
  /** BR-CLN-05: a única conta `CLINIC_ADMIN` ativa de uma clínica (UNIQUE parcial, schema.md). */
  findActiveAdminByClinic(trx: Trx, clinicId: string): Promise<ClinicAccount | null>;
  /** `adminCreateOrResetClinicRootAccount` (D18): idempotente, nunca cria uma segunda conta. */
  resetCredentials(trx: Trx, id: string, changes: ClinicAccountCredentialsReset, now: Date): Promise<ClinicAccount>;
  updateStatus(trx: Trx, id: string, status: ClinicAccountStatus, now: Date): Promise<ClinicAccount>;
}

export interface NewClinicSessionRecord {
  id: string;
  clinicAccountId: string;
  refreshTokenHash: string;
  tokenChainId: string;
  userAgent?: string;
  ip?: string;
  expiresAt: Date;
  createdAt: Date;
}

/** `clinic_sessions` (schema.md §1) — propriedade exclusiva deste módulo. */
export interface ClinicSessionRepository<Trx> {
  insert(trx: Trx, record: NewClinicSessionRecord): Promise<ClinicSession>;
  findByRefreshTokenHash(trx: Trx, refreshTokenHash: string): Promise<ClinicSession | null>;
  revoke(trx: Trx, id: string, revokedAt: Date): Promise<void>;
  revokeChain(trx: Trx, tokenChainId: string, revokedAt: Date): Promise<void>;
}

export interface ClinicSentEmail {
  to: string;
  subject: string;
  text: string;
}

/** Porta de e-mail própria do portal da clínica (ADR-020: não importa `modules/auth`). */
export interface ClinicMailer {
  send(email: ClinicSentEmail): Promise<void>;
}

export interface ClinicsDeps<Trx> {
  clinicsRepo: ClinicsRepository<Trx>;
  access: AccessPort<Trx>;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
  // Portal da clínica (D17/D18): só usados por `admin-clinic-root-account.ts` e
  // `clinic-login.ts`/`clinic-refresh.ts`/`clinic-logout.ts` — as restantes operações de `clinics`
  // (família/admin de `Clinic`) ignoram estes campos.
  clinicAccountRepo: ClinicAccountRepository<Trx>;
  clinicSessionRepo: ClinicSessionRepository<Trx>;
  clinicMailer: ClinicMailer;
  logger: Logger;
  clinicRateLimiter: ClinicInMemoryRateLimiter;
  clinicSigningKeys: ClinicSigningKey[];
  clinicAccessTtlSeconds: number;
  clinicRefreshTtlMs: number;
}

export type { Clinic, ClinicStatus, ClinicType } from "../domain/clinic.js";
export type { ClinicAccount, ClinicAccountRole, ClinicAccountStatus } from "../domain/clinic-account.js";
export type { ClinicSession } from "../domain/clinic-session.js";
