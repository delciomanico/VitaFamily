// Portas do módulo `clinic-reports` (conventions.md §3.2, modules.md §2 nota 27): definidas aqui, implementadas em
// `infrastructure` (Kysely, pdfkit) ou ligadas no composition root às APIs públicas de `appointments`, `clinic-patients`,
// `clinics` e `access`. O módulo NÃO importa `auth`, `access`, `families`, `insurance`, `insurer-ops`, `clinic-receipts`
// nem módulos de saúde. Genéricas em `Trx` para esta camada nunca importar "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { RateLimiter } from "../../../platform/rate-limit/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { ConsultationBookingKind, ConsultationReport, ReportIssuer, ReportSections } from "../domain/consultation-report.js";
import type { PdfDocument } from "../domain/pdf-document.js";

/** Ator do portal da clínica (`platform/actor.ClinicActorInfo`, ADR-020) — só o que esta camada precisa. */
export interface ClinicPortalActor {
  clinicAccountId: string;
  clinicId: string;
  role: "CLINIC_ADMIN" | "CLINIC_MANAGER" | "CLINIC_DOCTOR";
  /** Só no Médico (BR-CLN-39/44). */
  professionalId?: string;
}

/** Ator `User` do lado família (a autorização é da porta `PatientAccessPort`, nunca daqui). */
export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
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

// --- Portas para dados de outros módulos (ligadas no composition root) ---

/** Marcação da própria clínica vista pelo relatório; nunca ids Vita (BR-CLN-50). */
export interface BookingFacts {
  status: string;
  patientName: string;
  consultationAt: Date;
  specialty?: string;
  slotId?: string;
  clinicPatientId?: string;
  patientBirthDate?: string;
}

export interface BookingSourcePort<Trx> {
  /** `null` se a marcação não existe ou é de outra clínica (404 sem enumeração). */
  find(trx: Trx, clinicId: string, kind: ConsultationBookingKind, bookingId: string): Promise<BookingFacts | null>;
}

/** A consulta existe no membro/família e a sua clínica — SEM dados clínicos (authorization.md §6.6). */
export interface FamilyAppointmentLookupPort<Trx> {
  find(trx: Trx, familyId: string, memberId: string, appointmentId: string): Promise<{ clinicId: string } | null>;
}

export interface ClinicProfileReaderPort<Trx> {
  /** Cabeçalho da clínica (nome de apresentação ?? nome, morada, contactos) no momento. */
  get(trx: Trx, clinicId: string): Promise<{ issuer: ReportIssuer }>;
}

export interface ProfessionalReaderPort<Trx> {
  /** Nome do profissional do catálogo (assinatura textual); `null` se de outra clínica/inexistente. */
  findName(trx: Trx, clinicId: string, professionalId: string): Promise<string | null>;
  /** Profissional do horário (BR-CLN-44); `null` se o horário não existe nesta clínica. */
  professionalOfSlot(trx: Trx, clinicId: string, slotId: string): Promise<{ professionalId: string | null; name: string | null } | null>;
}

/** `AccessPolicy.can(VIEW_CONSULTATION_REPORT)`: só `SELF` adulto ou `TUTOR_OF` (authorization.md §6.6); senão lança. */
export interface PatientAccessPort<Trx> {
  assertCanReadReport(trx: Trx, actor: ActorIdentity, familyId: string, memberId: string): Promise<{ relation: "SELF" | "TUTOR_OF" }>;
}

/** ADR-027: adaptador de biblioteca de PDF JS pura, sem Chromium; só desenha a estrutura montada no domínio. */
export interface PdfRendererPort {
  render(document: PdfDocument): Promise<Buffer>;
}

// --- Repositório (propriedade exclusiva deste módulo, schema.md §3g) ---

export interface ReportRecord extends ReportSections {
  id: string;
  clinicId: string;
  bookingKind: ConsultationBookingKind;
  bookingId: string;
  clinicPatientId: string | null;
  status: "DRAFT" | "FINAL";
  sharedWithPatient: boolean;
  patientName: string;
  patientBirthDate: string | null;
  consultationAt: Date;
  specialty: string | null;
  authorName: string;
  issuer: ReportIssuer | null;
  authorAccountId: string;
  finalizedAt: Date | null;
  now: Date;
}

export interface NewAddendumRecord {
  id: string;
  clinicId: string;
  reportId: string;
  text: string;
  authorName: string;
  authorAccountId: string;
  createdAt: Date;
}

export interface ReportsRepository<Trx> {
  /** `INSERT … ON CONFLICT (clinic_id, booking_kind, booking_id) DO UPDATE … WHERE status = 'DRAFT'`: `null` se já `FINAL`. */
  upsert(trx: Trx, record: ReportRecord): Promise<ConsultationReport | null>;
  /** Sempre filtrado por `clinicId` (isolamento, 404 sem enumeração). `lock` = `FOR UPDATE` da linha do relatório. */
  findByBooking(trx: Trx, clinicId: string, kind: ConsultationBookingKind, bookingId: string, lock?: boolean): Promise<ConsultationReport | null>;
  /** Leitura por id da marcação sem saber o tipo (despacho pelo id, BR-CLN-18). */
  findByBookingId(trx: Trx, clinicId: string, bookingId: string): Promise<ConsultationReport | null>;
  countAddenda(trx: Trx, clinicId: string, reportId: string): Promise<number>;
  insertAddendum(trx: Trx, record: NewAddendumRecord): Promise<void>;
  /** `bookingId -> status` dos relatórios das marcações (decora `ClinicBooking.reportStatus`). */
  statusesByBookings(trx: Trx, clinicId: string, kind: ConsultationBookingKind, bookingIds: string[]): Promise<Map<string, "DRAFT" | "FINAL">>;
  /** `bookingId`s (consultas Vita) com relatório `FINAL` partilhado (decora `Appointment.reportAvailable`). */
  sharedFinalAppointments(trx: Trx, bookings: { clinicId: string; bookingId: string }[]): Promise<Set<string>>;
}

export interface ClinicReportsDeps<Trx> {
  reportsRepo: ReportsRepository<Trx>;
  bookings: BookingSourcePort<Trx>;
  familyAppointments: FamilyAppointmentLookupPort<Trx>;
  profile: ClinicProfileReaderPort<Trx>;
  professionals: ProfessionalReaderPort<Trx>;
  patientAccess: PatientAccessPort<Trx>;
  pdf: PdfRendererPort;
  audit: AuditPort<Trx>;
  withTransaction: WithTransaction<Trx>;
  /** 60/min por conta nas escritas, 30/min nos PDF (PROPOSTO, BR-CLN-46/47). */
  limiter: RateLimiter;
  clock: Clock;
}
