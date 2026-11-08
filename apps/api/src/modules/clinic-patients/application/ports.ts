// Portas do módulo `clinic-patients` (conventions.md §3.2, modules.md §2 nota 24): definidas aqui,
// implementadas em `infrastructure` (Kysely) ou ligadas no composition root às APIs públicas de
// `access`/`clinics`/`families`/`medications`/`examinations`/`appointments`/`recommendations`.
// Genéricas em `Trx` para esta camada nunca importar "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { CalendarEntryStatus } from "../domain/calendar.js";
import type { ClinicConsent, ClinicConsentLevel } from "../domain/consent.js";
import type { ClinicLinkVia, ClinicPatient, ClinicPatientOrigin, PatientCursor, PatientSearchTerms } from "../domain/clinic-patient.js";
import type { ClinicVisit, ClinicVisitStatus } from "../domain/clinic-visit.js";
import type { RateLimiter } from "../domain/rate-limiter.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/** Ator do portal da clínica (`platform/actor.ClinicActorInfo`, ADR-020) — só o que esta camada precisa. */
export interface ClinicPortalActor {
  clinicAccountId: string;
  clinicId: string;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

/** Subconjunto de `access.policy` (BR-CLN-19: só `SELF` adulto ou `TUTOR_OF`, via `MANAGE_CLINIC_CONSENT`). */
export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

// --- Repositórios (propriedade exclusiva deste módulo, schema.md §3d) ---

export interface NewPatientRecord {
  id: string;
  clinicId: string;
  name: string;
  nameNorm: string;
  phone: string | null;
  phoneDigits: string | null;
  email: string | null;
  birthDate: string | null;
  notes: string | null;
  origin: ClinicPatientOrigin;
  createdByClinicAccountId: string | null;
  createdAt: Date;
}

export interface PatientChanges {
  name?: string;
  nameNorm?: string;
  phone?: string | null;
  phoneDigits?: string | null;
  email?: string | null;
  birthDate?: string | null;
  notes?: string | null;
}

export interface PatientListFilter {
  terms?: PatientSearchTerms;
  after?: PatientCursor;
}

export interface PatientsRepository<Trx> {
  insert(trx: Trx, record: NewPatientRecord): Promise<ClinicPatient>;
  /** Sempre filtrado por `clinicId` (isolamento, 404 sem enumeração). */
  findById(trx: Trx, clinicId: string, patientId: string): Promise<ClinicPatient | null>;
  findManyByIds(trx: Trx, clinicId: string, patientIds: string[]): Promise<ClinicPatient[]>;
  update(trx: Trx, clinicId: string, patientId: string, changes: PatientChanges, now: Date): Promise<ClinicPatient>;
  /** BR-CLN-29 `newPatients`: registos criados em `[from, to)` (só a contagem). */
  countCreatedBetween(trx: Trx, clinicId: string, from: Date, to: Date): Promise<number>;
  /** Por nome (`name_norm`, `id`); varrimento "contém" dentro da clínica (indexes.md). Devolve até `limit` linhas. */
  list(trx: Trx, clinicId: string, filter: PatientListFilter, limit: number): Promise<ClinicPatient[]>;
}

export interface ClinicPatientLink {
  clinicId: string;
  clinicPatientId: string;
  familyId: string;
  memberId: string;
  via: ClinicLinkVia;
}

export interface LinksRepository<Trx> {
  /** `UNIQUE (clinic_patient_id)` e `UNIQUE (clinic_id, member_id)`: violação => `ConflictError`. */
  insert(trx: Trx, link: ClinicPatientLink): Promise<void>;
  findByPatient(trx: Trx, clinicId: string, patientId: string): Promise<ClinicPatientLink | null>;
  findByMember(trx: Trx, clinicId: string, memberId: string): Promise<ClinicPatientLink | null>;
  findByPatients(trx: Trx, clinicId: string, patientIds: string[]): Promise<ClinicPatientLink[]>;
  findByMembers(trx: Trx, clinicId: string, memberIds: string[]): Promise<ClinicPatientLink[]>;
  listByMember(trx: Trx, familyId: string, memberId: string): Promise<ClinicPatientLink[]>;
  deleteByMember(trx: Trx, clinicId: string, memberId: string): Promise<boolean>;
}

export interface ConsentWrite {
  clinicId: string;
  familyId: string;
  memberId: string;
  level: ClinicConsentLevel;
  historyValidUntil: Date | null;
  grantedByUserId: string | null;
  now: Date;
}

export interface ConsentsRepository<Trx> {
  find(trx: Trx, clinicId: string, memberId: string): Promise<ClinicConsent | null>;
  findMany(trx: Trx, clinicId: string, memberIds: string[]): Promise<ClinicConsent[]>;
  listByMember(trx: Trx, familyId: string, memberId: string): Promise<ClinicConsent[]>;
  /** `PUT`: idempotente (`ON CONFLICT (clinic_id, member_id) DO UPDATE`). */
  upsert(trx: Trx, write: ConsentWrite): Promise<void>;
  /** `BOOKINGS` implícito (BR-CLN-19): cria só se não existir (nunca baixa um `HISTORY`); devolve se criou. */
  insertBookingsIfMissing(trx: Trx, clinicId: string, familyId: string, memberId: string, now: Date): Promise<boolean>;
  delete(trx: Trx, clinicId: string, memberId: string): Promise<boolean>;
}

export interface LinkCodeRecord {
  id: string;
  familyId: string;
  memberId: string;
  codeHash: string;
  expiresAt: Date;
  createdByUserId: string | null;
  createdAt: Date;
}

export interface LinkCodesRepository<Trx> {
  /** BR-CLN-20: os códigos ativos do membro ficam com `used_at = now`. */
  invalidateActive(trx: Trx, memberId: string, now: Date): Promise<void>;
  insert(trx: Trx, record: LinkCodeRecord): Promise<void>;
  /** Códigos criados pelo membro desde `since` (limite 5/h), do mais antigo para o mais recente. */
  listCreatedSince(trx: Trx, memberId: string, since: Date): Promise<Date[]>;
  /** Consumo atómico: `UPDATE … WHERE used_at IS NULL AND expires_at > now RETURNING` (1 só vence sob concorrência). */
  consume(trx: Trx, codeHash: string, now: Date): Promise<{ familyId: string; memberId: string } | null>;
  /** Job diário: apaga os expirados ou usados há mais de `olderThan`; devolve a contagem. */
  purge(trx: Trx, olderThan: Date): Promise<number>;
}

export interface NewVisitRecord {
  id: string;
  clinicId: string;
  clinicPatientId: string;
  slotId: string;
  scheduledAt: Date;
  durationMinutes: number;
  notes: string | null;
  bookedByClinicAccountId: string;
  createdAt: Date;
}

export interface VisitListFilter {
  statuses?: ClinicVisitStatus[];
  from?: Date;
  /** Exclusivo (`scheduled_at < to`). */
  to?: Date;
  clinicPatientId?: string;
}

/** BR-CLN-28: chegada/início/falta; só os campos presentes mudam. */
export interface VisitDayFlowChange {
  status?: ClinicVisitStatus;
  arrivedAt?: Date;
  startedAt?: Date;
}

export interface VisitsRepository<Trx> {
  /** UNIQUE parcial `(slot_id) WHERE SCHEDULED`: violação => `ConflictError`. */
  insert(trx: Trx, record: NewVisitRecord): Promise<ClinicVisit>;
  findById(trx: Trx, clinicId: string, visitId: string): Promise<ClinicVisit | null>;
  list(trx: Trx, clinicId: string, filter: VisitListFilter, limit?: number): Promise<ClinicVisit[]>;
  countScheduledBySlot(trx: Trx, slotIds: string[]): Promise<{ slotId: string; count: number }[]>;
  /** Visitas `SCHEDULED` do paciente cujo intervalo `[início, início+duração)` sobrepõe `[from, to)` (BR-CLN-16). */
  findScheduledOverlapping(trx: Trx, clinicPatientId: string, from: Date, to: Date): Promise<ClinicVisit[]>;
  setStatus(trx: Trx, clinicId: string, visitId: string, change: { status: ClinicVisitStatus; outcomeNote?: string | null; cancelNote?: string | null }, now: Date): Promise<ClinicVisit>;
  /** BR-CLN-27: "confirmado por telefone" (`CLINIC`). */
  applyConfirmation(trx: Trx, clinicId: string, visitId: string, confirmedAt: Date): Promise<ClinicVisit>;
  /** BR-CLN-28: chegada/início/falta (`NO_SHOW -> SCHEDULED` na chegada tardia: violação da UNIQUE do horário => `ConflictError`). */
  applyDayFlow(trx: Trx, clinicId: string, visitId: string, change: VisitDayFlowChange, now: Date): Promise<ClinicVisit>;
  /** BR-CLN-30: define (AAAA-MM-DD) ou limpa (`null`) o retorno. */
  setFollowUp(trx: Trx, clinicId: string, visitId: string, dueOn: string | null, now: Date): Promise<ClinicVisit>;
  /** BR-CLN-30: visitas `COMPLETED` com retorno até `until` (AAAA-MM-DD), por data. */
  listFollowUps(trx: Trx, clinicId: string, until: string, limit: number): Promise<ClinicVisit[]>;
}

// --- Portas para outros módulos (ligadas no composition root, modules.md §2) ---

/** `MemberDirectory`: nome do membro Vita (para `displayName` na ligação por código e no calendário). */
export interface MemberDirectoryPort<Trx> {
  getMemberName(trx: Trx, familyId: string, memberId: string): Promise<string | null>;
}

/** Clínica parceira (API pública de `clinics`): o consentimento é por clínica PARCEIRA ativa (BR-CLN-19). */
export interface ClinicDirectoryPort<Trx> {
  findPartnerClinic(trx: Trx, clinicId: string): Promise<{ id: string; name: string; active: boolean } | null>;
}

export interface SharedMedication {
  name: string;
  dosage: string;
  startAt: Date;
  endAt: Date | null;
  continuous: boolean;
}

export interface SharedExamResult {
  parameter: string;
  valueNumeric: number | null;
  valueText: string | null;
  unit: string | null;
  referenceMin: number | null;
  referenceMax: number | null;
}

export interface SharedExam {
  name: string;
  examDate: string;
  status: "SCHEDULED" | "COMPLETED";
  results: SharedExamResult[];
}

/** `SharedHistoryReader` (BR-CLN-21): só leitura; medicação `ACTIVE` e exames `SCHEDULED|COMPLETED` desde `examsSince` (AAAA-MM-DD) e futuros. */
export interface SharedHistoryReaderPort<Trx> {
  listActiveMedications(trx: Trx, familyId: string, memberId: string): Promise<SharedMedication[]>;
  listExams(trx: Trx, familyId: string, memberId: string, examsSince: string): Promise<SharedExam[]>;
}

/** Consulta Vita da própria clínica (facto mínimo; o nome do paciente resolve-se por `MemberDirectory`). */
export interface AppointmentFact {
  id: string;
  status: CalendarEntryStatus;
  startsAt: Date;
  durationMinutes: number;
  specialty?: string;
  professionalName?: string;
  slotId?: string;
  familyId: string;
  memberId: string;
  notes?: string;
  responseNote?: string;
  /** M14 Q (BR-CLN-25/28). */
  confirmationStatus: "PENDING" | "CONFIRMED" | "DECLINED";
  arrivedAt?: Date;
  startedAt?: Date;
}

export interface ExaminationFact {
  id: string;
  status: "SCHEDULED" | "COMPLETED";
  startsAt: Date;
  examType?: string;
  slotId?: string;
  familyId: string;
  memberId: string;
  notes?: string;
  responseNote?: string;
  resultsCount: number;
}

/** `CalendarSource` (BR-CLN-22/23): consultas e exames da própria clínica (implementada por `appointments`/`examinations`). */
export interface CalendarSourcePort<Trx> {
  listAppointments(trx: Trx, clinicId: string, window: { from: Date; to: Date }): Promise<AppointmentFact[]>;
  listExaminations(trx: Trx, clinicId: string, window: { from: Date; to: Date }): Promise<ExaminationFact[]>;
  /** Pesquisa global: as `limit` marcações mais recentes por data (varrimento dentro da clínica). */
  listRecentAppointments(trx: Trx, clinicId: string, limit: number): Promise<AppointmentFact[]>;
  listRecentExaminations(trx: Trx, clinicId: string, limit: number): Promise<ExaminationFact[]>;
  /** Ficha: marcações da clínica com este membro (só pela ligação). */
  listAppointmentsOfMember(trx: Trx, clinicId: string, familyId: string, memberId: string, limit: number): Promise<AppointmentFact[]>;
  listExaminationsOfMember(trx: Trx, clinicId: string, familyId: string, memberId: string, limit: number): Promise<ExaminationFact[]>;
}

/** Retorno por tratar de uma consulta Vita (facto mínimo; o nome e o telefone resolvem-se no servidor). */
export interface FollowUpFact {
  id: string;
  familyId: string;
  memberId: string;
  dueOn: string;
}

/**
 * `ReportSource` (BR-CLN-29/30, modules.md §3 nota 25): consultas e exames da janela (para as contagens, só `status`/`slotId`/
 * `confirmationStatus` são lidos) e retornos Vita por tratar. Implementada no composition root por `appointments` e
 * `examinations`; os horários/capacidade vêm da porta `SlotReservation` (`clinics`).
 */
export interface ReportSourcePort<Trx> {
  listAppointments(trx: Trx, clinicId: string, window: { from: Date; to: Date }): Promise<AppointmentFact[]>;
  listExaminations(trx: Trx, clinicId: string, window: { from: Date; to: Date }): Promise<ExaminationFact[]>;
  listAppointmentFollowUps(trx: Trx, clinicId: string, until: string, limit: number): Promise<FollowUpFact[]>;
}

export interface RecommendationFact {
  id: string;
  appointmentId?: string;
  examinationId?: string;
  text: string;
  createdAt: Date;
}

/** Recomendações emitidas pela clínica a este membro (ficha; implementada por `recommendations`). */
export interface RecommendationsSourcePort<Trx> {
  listOfMember(trx: Trx, clinicId: string, familyId: string, memberId: string, limit: number): Promise<RecommendationFact[]>;
}

export interface SlotFacts {
  id: string;
  clinicId: string;
  kind: "APPOINTMENT" | "EXAM";
  specialty: string;
  professionalId?: string;
  professionalName?: string;
  startsAt: Date;
  durationMinutes: number;
  capacity: number;
}

/** `SlotReservation`: bloqueio do horário (`FOR UPDATE`), ocupação por consultas+exames e horários da clínica (`clinics`+`appointments`+`examinations`). */
export interface SlotReservationPort<Trx> {
  lockSlot(trx: Trx, slotId: string): Promise<SlotFacts | null>;
  listSlots(trx: Trx, clinicId: string, window: { from: Date; to: Date }): Promise<SlotFacts[]>;
  findSlotsByIds(trx: Trx, clinicId: string, slotIds: string[]): Promise<SlotFacts[]>;
  countActiveBySlot(trx: Trx, slotIds: string[]): Promise<{ slotId: string; requested: number; scheduled: number }[]>;
  listProfessionalSlotsOverlapping(trx: Trx, professionalId: string, from: Date, to: Date, excludeSlotId: string): Promise<string[]>;
  findProfessional(trx: Trx, clinicId: string, professionalId: string): Promise<{ id: string; name: string } | null>;
}

export interface ClinicPatientsDeps<Trx> {
  patientsRepo: PatientsRepository<Trx>;
  linksRepo: LinksRepository<Trx>;
  consentsRepo: ConsentsRepository<Trx>;
  codesRepo: LinkCodesRepository<Trx>;
  visitsRepo: VisitsRepository<Trx>;
  policy: AccessPolicyPort<Trx>;
  members: MemberDirectoryPort<Trx>;
  clinics: ClinicDirectoryPort<Trx>;
  sharedHistory: SharedHistoryReaderPort<Trx>;
  calendar: CalendarSourcePort<Trx>;
  /** M14 Q (BR-CLN-29/30). */
  reports: ReportSourcePort<Trx>;
  recommendations: RecommendationsSourcePort<Trx>;
  slots: SlotReservationPort<Trx>;
  /** Pesquisa/listagem: 60/min por conta (limiter próprio). */
  searchLimiter: RateLimiter;
  /** BR-CLN-29: indicadores, 30 pedidos/min por conta (limiter próprio). */
  reportLimiter: RateLimiter;
  /** BR-CLN-20: limiter partilhado com o walk-in (BR-CLN-10) — mesmas chaves `walk-in:*`. */
  sharedLimiter: RateLimiter;
  audit: AuditPort<Trx>;
  /** Segredo do HMAC dos códigos (`CLINIC_LINK_CODE_SECRET`). */
  linkCodeSecret: string;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}
