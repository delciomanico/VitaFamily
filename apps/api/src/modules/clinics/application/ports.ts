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
import type { ClinicSlot, ClinicSlotKind, SlotBookingCounts } from "../domain/clinic-slot.js";
import type { ClinicProfessional, ClinicServiceType } from "../domain/clinic-catalog.js";
import type { ClinicScheduleRule, ClinicTimeOff } from "../domain/clinic-schedule.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/**
 * Ator do portal da clínica (ADR-020, `platform/actor.ClinicActorInfo`) — só os campos que
 * `clinics/application` precisa, sem importar `platform/actor` aqui (essa leitura é da
 * `interface`, conventions.md §3.9). Usado por `manage-clinic-staff.ts`/`clinic-slots.ts`
 * (Fase C, BR-CLN-04/05).
 */
export interface ClinicPortalActor {
  clinicAccountId: string;
  clinicId: string;
  role: ClinicAccountRole;
  /** M14 R (BR-CLN-39): só no Médico. */
  professionalId?: string;
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
  /** M14 R (BR-CLN-38): perfil da clínica parceira. */
  displayName?: string | null;
  description?: string | null;
  openingHours?: string | null;
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
  /** BR-CLN-39: obrigatório em `CLINIC_DOCTOR`. */
  professionalId?: string;
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
  /** BR-CLN-39: a conta Médico de um profissional (uma por profissional). */
  findByProfessionalId(trx: Trx, professionalId: string): Promise<ClinicAccount | null>;
  /** BR-CLN-05/39 (Fase C): contas da própria clínica, filtradas por papéis (`listClinicStaff`). */
  listByClinic(trx: Trx, clinicId: string, roles?: ClinicAccountRole[]): Promise<ClinicAccount[]>;
  /** BR-ADM-03: contas da clínica com o último login (início da cadeia de refresh mais recente). */
  listByClinicWithLastLogin(trx: Trx, clinicId: string): Promise<{ account: ClinicAccount; lastLoginAt: Date | null }[]>;
  /** `removeClinicStaff` (Fase C) — quem chama já validou com `assertRemovableStaffTarget`. */
  delete(trx: Trx, id: string): Promise<void>;
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
  /** BR-ADM-04: revoga de imediato todas as sessões da conta (suspensão). */
  revokeAllForAccount(trx: Trx, clinicAccountId: string, revokedAt: Date): Promise<void>;
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

// --- `ClinicSlot` (Fase C, schema.md §3 v0.2, BR-CLN-04/UC-CLN-04) ---

export interface NewClinicSlotRecord {
  id: string;
  clinicId: string;
  kind: ClinicSlotKind;
  specialty: string;
  professionalName?: string;
  startsAt: Date;
  durationMinutes: number;
  capacity: number;
  /** M14 (a1/a2): ligação ao catálogo/regra (BR-CLN-11/12); `ends_at` é calculado pelo repositório. */
  professionalId?: string;
  serviceTypeId?: string;
  scheduleRuleId?: string;
  createdAt: Date;
}

export interface ClinicSlotListFilter {
  kind?: ClinicSlotKind;
  from?: Date;
  to?: Date;
  specialty?: string;
}

export interface ClinicSlotDuplicateCheck {
  kind: ClinicSlotKind;
  startsAt: Date;
  specialty: string;
  professionalName?: string;
}

/** `clinic_slots` (schema.md §3 v0.2) — propriedade exclusiva deste módulo. */
export interface ClinicSlotsRepository<Trx> {
  insert(trx: Trx, record: NewClinicSlotRecord): Promise<ClinicSlot>;
  findById(trx: Trx, slotId: string): Promise<ClinicSlot | null>;
  /** Da própria clínica, por período opcional (`listOwnClinicSlots`/`listFreeSlots`). */
  listByClinic(trx: Trx, clinicId: string, filter: ClinicSlotListFilter): Promise<ClinicSlot[]>;
  /** BR-CLN-04: ignora duplicadas (mesma hora, especialidade, profissional) ao publicar. */
  existsDuplicate(trx: Trx, clinicId: string, slot: ClinicSlotDuplicateCheck): Promise<boolean>;
  delete(trx: Trx, slotId: string): Promise<void>;
  /** BR-APT-11: `SELECT … FOR UPDATE` da linha do horário — serializa marcação, `PATCH` e `DELETE`. */
  lockById(trx: Trx, slotId: string): Promise<ClinicSlot | null>;
  updateCapacity(trx: Trx, slotId: string, capacity: number): Promise<ClinicSlot>;
  /** BR-CLN-12 (geração): `INSERT … ON CONFLICT DO NOTHING` (unicidade `(regra, início)` e exclusão de
   * sobreposição); devolve só os horários efetivamente criados. */
  insertManyIgnoringConflicts(trx: Trx, records: NewClinicSlotRecord[]): Promise<ClinicSlot[]>;
  /** Horários do profissional cujo intervalo termina depois de `endsAfter` e começa antes de `startsBefore`. */
  listByProfessional(trx: Trx, professionalId: string, filter: { endsAfter?: Date; startsBefore?: Date }): Promise<ClinicSlot[]>;
  /** BR-CLN-15: horários da regra que começam depois de `after`. */
  listFutureByRule(trx: Trx, scheduleRuleId: string, after: Date): Promise<ClinicSlot[]>;
  /** `SELECT … FOR UPDATE` por ordem de id (serializa com reservas, BR-APT-11). */
  lockMany(trx: Trx, slotIds: string[]): Promise<ClinicSlot[]>;
  /** M14 P: horários (da clínica) pelos ids — leitura para o calendário/ficha de `clinic-patients`. */
  listByIds(trx: Trx, clinicId: string, slotIds: string[]): Promise<ClinicSlot[]>;
  deleteMany(trx: Trx, slotIds: string[]): Promise<void>;
}

// --- Catálogo, regras e bloqueios (M14 a1/a2, ADR-026) ---

export interface NewClinicProfessionalRecord {
  id: string;
  clinicId: string;
  name: string;
  specialty: string | null;
  createdAt: Date;
}

export interface ClinicProfessionalChanges {
  name?: string;
  specialty?: string | null;
  active?: boolean;
}

export interface NewClinicServiceTypeRecord {
  id: string;
  clinicId: string;
  name: string;
  kind: ClinicSlotKind;
  durationMinutes: number;
  priceMinor: number | null;
  createdAt: Date;
}

export interface ClinicServiceTypeChanges {
  name?: string;
  durationMinutes?: number;
  priceMinor?: number | null;
  active?: boolean;
}

/** `clinic_professionals`/`clinic_service_types`/`clinics.currency` — nome duplicado entre ativos lança `ConflictError`. */
export interface ClinicCatalogRepository<Trx> {
  /** Serializa criações (limites por clínica, BR-CLN-11). */
  lockClinic(trx: Trx, clinicId: string): Promise<void>;
  getCurrency(trx: Trx, clinicId: string): Promise<string>;
  insertProfessional(trx: Trx, record: NewClinicProfessionalRecord): Promise<ClinicProfessional>;
  findProfessional(trx: Trx, clinicId: string, professionalId: string): Promise<ClinicProfessional | null>;
  /** `SELECT … FOR UPDATE` da linha (ordem profissional → horário, schema.md §3a). */
  lockProfessional(trx: Trx, clinicId: string, professionalId: string): Promise<ClinicProfessional | null>;
  listProfessionals(trx: Trx, clinicId: string, filter: { active?: boolean }): Promise<ClinicProfessional[]>;
  countProfessionals(trx: Trx, clinicId: string): Promise<number>;
  updateProfessional(trx: Trx, professionalId: string, changes: ClinicProfessionalChanges): Promise<ClinicProfessional>;
  insertServiceType(trx: Trx, record: NewClinicServiceTypeRecord): Promise<ClinicServiceType>;
  findServiceType(trx: Trx, clinicId: string, serviceTypeId: string): Promise<ClinicServiceType | null>;
  listServiceTypes(trx: Trx, clinicId: string, filter: { active?: boolean; kind?: ClinicSlotKind }): Promise<ClinicServiceType[]>;
  countServiceTypes(trx: Trx, clinicId: string): Promise<number>;
  updateServiceType(trx: Trx, serviceTypeId: string, changes: ClinicServiceTypeChanges): Promise<ClinicServiceType>;
}

export interface NewClinicScheduleRuleRecord {
  id: string;
  clinicId: string;
  professionalId: string;
  serviceTypeId: string;
  weekdays: number[];
  startTime: string;
  endTime: string;
  validFrom: string | null;
  validUntil: string | null;
  capacity: number;
  createdAt: Date;
}

export interface ClinicScheduleRuleChanges {
  weekdays?: number[];
  startTime?: string;
  endTime?: string;
  validFrom?: string | null;
  validUntil?: string | null;
  capacity?: number;
  active?: boolean;
}

/** `clinic_schedule_rules` — nunca se apagam (BR-CLN-12). */
export interface ClinicScheduleRulesRepository<Trx> {
  insert(trx: Trx, record: NewClinicScheduleRuleRecord): Promise<ClinicScheduleRule>;
  findById(trx: Trx, clinicId: string, ruleId: string): Promise<ClinicScheduleRule | null>;
  list(trx: Trx, clinicId: string, filter: { professionalId?: string; active?: boolean }): Promise<ClinicScheduleRule[]>;
  count(trx: Trx, clinicId: string): Promise<number>;
  listActiveByProfessional(trx: Trx, professionalId: string): Promise<ClinicScheduleRule[]>;
  update(trx: Trx, ruleId: string, changes: ClinicScheduleRuleChanges): Promise<ClinicScheduleRule>;
  /** Job diário: regras ativas de profissionais e serviços ativos (todas as clínicas). */
  listActiveForGeneration(trx: Trx): Promise<ClinicScheduleRule[]>;
}

export interface NewClinicTimeOffRecord {
  id: string;
  clinicId: string;
  professionalId: string;
  startsAt: Date;
  endsAt: Date;
  reason: string | null;
  createdByClinicAccountId: string;
  createdAt: Date;
}

/** `clinic_time_off`. */
export interface ClinicTimeOffRepository<Trx> {
  insert(trx: Trx, record: NewClinicTimeOffRecord): Promise<ClinicTimeOff>;
  findById(trx: Trx, clinicId: string, timeOffId: string): Promise<ClinicTimeOff | null>;
  list(trx: Trx, clinicId: string, filter: { professionalId?: string; endsAfter: Date; startsBefore?: Date }): Promise<ClinicTimeOff[]>;
  /** Bloqueios do profissional que intersectam `[from, to)`. */
  listOverlapping(trx: Trx, professionalId: string, from: Date, to: Date): Promise<ClinicTimeOff[]>;
  delete(trx: Trx, timeOffId: string): Promise<void>;
}

/** Marcações ativas de um horário (consultas `REQUESTED`/`SCHEDULED`, exames `SCHEDULED`). */
export interface SlotBookingCountRow extends SlotBookingCounts {
  slotId: string;
}

/** Ocupação de horários por marcações ativas de consultas e exames (somada no composition root). */
export interface SlotOccupancyPort<Trx> {
  countActiveBySlot(trx: Trx, slotIds: string[]): Promise<SlotBookingCountRow[]>;
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
  /** `ClinicSlot` (Fase C) — usado por `manage-clinic-staff.ts`/`clinic-slots.ts`. */
  clinicSlotsRepo: ClinicSlotsRepository<Trx>;
  /** BR-CLN-04/BR-APT-06: quais dos horários têm marcação ativa (consulta OU exame). Ligada no
   * composition root a `appointments`/`examinations` (que dependem de `clinics`, nunca o inverso). */
  slotOccupancy: SlotOccupancyPort<Trx>;
  /** M14 (a1/a2, ADR-026): catálogo, regras e bloqueios. */
  catalogRepo: ClinicCatalogRepository<Trx>;
  scheduleRulesRepo: ClinicScheduleRulesRepository<Trx>;
  timeOffRepo: ClinicTimeOffRepository<Trx>;
  /** Janela rolante em semanas (BR-CLN-12, `CLINIC_SCHEDULE_HORIZON_WEEKS`); omitido = 8. */
  scheduleHorizonWeeks?: number;
}

export type { Clinic, ClinicStatus, ClinicType } from "../domain/clinic.js";
export type { ClinicAccount, ClinicAccountRole, ClinicAccountStatus } from "../domain/clinic-account.js";
export type { ClinicSession } from "../domain/clinic-session.js";
export type { ClinicSlot, ClinicSlotKind, ClinicSlotState, SlotBookingCounts, SlotOccupancy } from "../domain/clinic-slot.js";
export type { ClinicProfessional, ClinicServiceType } from "../domain/clinic-catalog.js";
export type { ClinicScheduleRule, ClinicTimeOff } from "../domain/clinic-schedule.js";
