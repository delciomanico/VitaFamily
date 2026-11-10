// Portas do módulo `clinic-reports` (conventions.md §3.2, modules.md §2 nota 27): definidas aqui, implementadas em
// `infrastructure` (Kysely, pdfkit) ou ligadas no composition root às APIs públicas de `appointments`, `clinic-patients`,
// `clinics` e `access`. O módulo NÃO importa `auth`, `access`, `families`, `insurance`, `insurer-ops`, `clinic-receipts`
// nem módulos de saúde. Genéricas em `Trx` para esta camada nunca importar "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { RateLimiter } from "../../../platform/rate-limit/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { ConsultationBookingKind, ConsultationReport, ReportIssuer, ReportSections } from "../domain/consultation-report.js";
import type { ExamOrder, ExamOrderStatus } from "../domain/exam-order.js";
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
  /** M15 V (BR-CLN-55): chegada registada (declaração de presença). */
  arrivedAt?: Date;
  /** M15 U (BR-CLN-53): só consultas Vita; SÓ no servidor (ponte e alerta), nunca na API do portal. */
  vitaMember?: { familyId: string; memberId: string };
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
  /** `AccessPolicy.can(VIEW_EXAM_ORDERS)` (M15 U, authorization.md §6.7): só `SELF` adulto ou `TUTOR_OF`; senão lança. */
  assertCanViewExamOrders(trx: Trx, actor: ActorIdentity, familyId: string, memberId: string): Promise<{ relation: "SELF" | "TUTOR_OF" }>;
}

/** Serviço do catálogo da clínica (implementada por `clinics`): `kind=EXAM` ativo => nome copiado para o pedido (BR-CLN-51). */
export interface ExamServiceCatalogPort<Trx> {
  find(trx: Trx, clinicId: string, serviceTypeId: string): Promise<{ id: string; name: string; kind: "APPOINTMENT" | "EXAM"; active: boolean } | null>;
}

/**
 * M15 U (modules.md §2 nota 28): alerta genérico `EXAM_ORDER_ADDED` (um por pedido, só `SELF`/`TUTOR_OF`). Definida aqui,
 * implementada no composition root sobre `alerts.raiseExamOrderEvent` (`alerts` não importa `clinic-reports`). Corre na
 * transação do chamador: sem pedido, sem alerta.
 */
export interface ExamOrderAlertsPort<Trx> {
  raiseExamOrderAdded(trx: Trx, input: { appointmentId: string; familyId: string; memberId: string }): Promise<void>;
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

// --- Pedidos de exame (propriedade exclusiva deste módulo, schema.md §3h) ---

export interface NewExamOrderRecord {
  id: string;
  clinicId: string;
  bookingKind: ConsultationBookingKind;
  bookingId: string;
  clinicPatientId: string | null;
  name: string;
  serviceTypeId: string | null;
  note: string | null;
  urgent: boolean;
  patientName: string;
  patientBirthDate: string | null;
  consultationAt: Date;
  authorName: string;
  authorAccountId: string;
  now: Date;
}

/** Ponte para o paciente Vita (`clinic_exam_order_links`): só consultas Vita. */
export interface NewExamOrderLink {
  orderId: string;
  familyId: string;
  memberId: string;
  appointmentId: string;
}

/** Pedido visto pelo titular/tutor (`FamilyExamOrder`): junta a ponte; `clinicId` serve para o nome da clínica. */
export interface FamilyExamOrderRow {
  id: string;
  appointmentId: string;
  clinicId: string;
  name: string;
  note: string | null;
  urgent: boolean;
  status: ExamOrderStatus;
  examinationId: string | null;
  createdAt: Date;
}

export interface ExamOrdersRepository<Trx> {
  /** `pg_advisory_xact_lock(hashtextextended(booking_id, 0))`: serializa o limite de 5 ativos por marcação (BR-CLN-51). */
  lockBooking(trx: Trx, bookingId: string): Promise<void>;
  /** Pedidos não cancelados da marcação. */
  countActive(trx: Trx, clinicId: string, bookingId: string): Promise<number>;
  insert(trx: Trx, record: NewExamOrderRecord): Promise<ExamOrder>;
  insertLink(trx: Trx, link: NewExamOrderLink, now: Date): Promise<void>;
  /** Todos os pedidos da marcação (incl. cancelados), por ordem de criação; sempre por `clinicId`. */
  listByBooking(trx: Trx, clinicId: string, bookingId: string): Promise<ExamOrder[]>;
  /** `lock` = `FOR UPDATE`. */
  findById(trx: Trx, clinicId: string, bookingId: string, orderId: string, lock?: boolean): Promise<ExamOrder | null>;
  /** `CANCELLED` + `booked_here=false` + desfaz a ligação (`examination_id` nulo); não toca no exame (BR-CLN-52). */
  cancel(trx: Trx, clinicId: string, orderId: string, accountId: string, now: Date): Promise<ExamOrder>;
  /** `bookingId -> nº de pedidos não cancelados` (decora `ClinicBooking.examOrderCount`). */
  activeCountsByBookings(trx: Trx, clinicId: string, bookingIds: string[]): Promise<Map<string, number>>;
  /** `appointmentId -> nº de pedidos não cancelados` das consultas Vita (decora `Appointment.examOrderCount`). */
  activeCountsByAppointments(trx: Trx, appointmentIds: string[]): Promise<Map<string, number>>;
  /** Pedidos do membro (via ponte); por omissão sem `CANCELLED`. */
  listForMember(trx: Trx, familyId: string, memberId: string, filter: { status?: ExamOrderStatus; appointmentId?: string }): Promise<FamilyExamOrderRow[]>;
  // Ligação ao exame (`ExamOrderLinker`): `lock` o pedido pela ponte do membro; `null` se não é deste membro.
  findLinkedForUpdate(trx: Trx, familyId: string, memberId: string, orderId: string): Promise<{ order: ExamOrder; examinationId: string | null } | null>;
  setLinked(trx: Trx, orderId: string, examinationId: string, status: "SCHEDULED" | "FULFILLED", bookedHere: boolean, now: Date): Promise<void>;
  /** Exame cancelado/apagado: pedido de novo `ORDERED` (não toca em `CANCELLED`); devolve o id do pedido ou `null`. */
  releaseByExamination(trx: Trx, examinationId: string, now: Date): Promise<string | null>;
  /** Exame `COMPLETED`: pedido `FULFILLED` (não toca em `CANCELLED`); devolve o id do pedido ou `null`. */
  fulfilByExamination(trx: Trx, examinationId: string, now: Date): Promise<string | null>;
}

export interface ClinicReportsDeps<Trx> {
  ordersRepo: ExamOrdersRepository<Trx>;
  orderAlerts: ExamOrderAlertsPort<Trx>;
  services: ExamServiceCatalogPort<Trx>;
  reportsRepo: ReportsRepository<Trx>;
  bookings: BookingSourcePort<Trx>;
  familyAppointments: FamilyAppointmentLookupPort<Trx>;
  profile: ClinicProfileReaderPort<Trx>;
  professionals: ProfessionalReaderPort<Trx>;
  patientAccess: PatientAccessPort<Trx>;
  pdf: PdfRendererPort;
  audit: AuditPort<Trx>;
  withTransaction: WithTransaction<Trx>;
  /** 60/min por conta nas escritas do relatório; 30/min nos PDF (bolsa partilhada com o pedido de exame e a declaração) e nas escritas de pedidos (BR-CLN-46/47/54). */
  limiter: RateLimiter;
  clock: Clock;
}
