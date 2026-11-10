// Fakes em memória das portas de `clinic-reports` (mesmo padrão dos outros módulos). Não é ficheiro de teste.
import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import { InMemoryRateLimiter } from "../../../platform/rate-limit/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { ConsultationBookingKind, ConsultationReport, ReportIssuer } from "../domain/consultation-report.js";
import type { ExamOrder, ExamOrderStatus } from "../domain/exam-order.js";
import type { PdfDocument } from "../domain/pdf-document.js";
import type {
  ActorIdentity,
  AuditPort,
  BookingFacts,
  BookingSourcePort,
  ClinicProfileReaderPort,
  ClinicReportsDeps,
  ExamOrderAlertsPort,
  ExamOrdersRepository,
  ExamServiceCatalogPort,
  FamilyAppointmentLookupPort,
  FamilyExamOrderRow,
  NewExamOrderLink,
  NewExamOrderRecord,
  NewAddendumRecord,
  PatientAccessPort,
  PdfRendererPort,
  ProfessionalReaderPort,
  ReportRecord,
  ReportsRepository,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];
  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export class FakeReportsRepository implements ReportsRepository<FakeTrx> {
  readonly reports = new Map<string, ConsultationReport>();

  private key(clinicId: string, kind: ConsultationBookingKind, bookingId: string): string {
    return `${clinicId}|${kind}|${bookingId}`;
  }

  async upsert(_trx: FakeTrx, r: ReportRecord): Promise<ConsultationReport | null> {
    const key = this.key(r.clinicId, r.bookingKind, r.bookingId);
    const existing = this.reports.get(key);
    if (existing?.status === "FINAL") return Promise.resolve(null);
    const saved: ConsultationReport = {
      id: existing?.id ?? r.id,
      clinicId: r.clinicId,
      bookingKind: r.bookingKind,
      bookingId: r.bookingId,
      clinicPatientId: r.clinicPatientId,
      status: r.status,
      reason: r.reason,
      findings: r.findings,
      impression: r.impression,
      plan: r.plan,
      sharedWithPatient: r.sharedWithPatient,
      patientName: r.patientName,
      patientBirthDate: r.patientBirthDate,
      consultationAt: r.consultationAt,
      specialty: r.specialty,
      authorName: r.authorName,
      issuer: r.issuer,
      authorAccountId: r.authorAccountId,
      finalizedAt: r.finalizedAt,
      addenda: existing?.addenda ?? [],
      createdAt: existing?.createdAt ?? r.now,
      updatedAt: r.now,
    };
    this.reports.set(key, saved);
    return Promise.resolve(saved);
  }
  async findByBooking(_trx: FakeTrx, clinicId: string, kind: ConsultationBookingKind, bookingId: string): Promise<ConsultationReport | null> {
    return Promise.resolve(this.reports.get(this.key(clinicId, kind, bookingId)) ?? null);
  }
  async findByBookingId(_trx: FakeTrx, clinicId: string, bookingId: string): Promise<ConsultationReport | null> {
    return Promise.resolve([...this.reports.values()].find((r) => r.clinicId === clinicId && r.bookingId === bookingId) ?? null);
  }
  async countAddenda(_trx: FakeTrx, clinicId: string, reportId: string): Promise<number> {
    return Promise.resolve([...this.reports.values()].find((r) => r.clinicId === clinicId && r.id === reportId)?.addenda.length ?? 0);
  }
  async insertAddendum(_trx: FakeTrx, record: NewAddendumRecord): Promise<void> {
    const report = [...this.reports.values()].find((r) => r.clinicId === record.clinicId && r.id === record.reportId);
    if (!report) throw new NotFoundError();
    report.addenda = [...report.addenda, { id: record.id, text: record.text, authorName: record.authorName, authorAccountId: record.authorAccountId, createdAt: record.createdAt }];
    return Promise.resolve();
  }
  async statusesByBookings(_trx: FakeTrx, clinicId: string, kind: ConsultationBookingKind, bookingIds: string[]): Promise<Map<string, "DRAFT" | "FINAL">> {
    return Promise.resolve(new Map([...this.reports.values()].filter((r) => r.clinicId === clinicId && r.bookingKind === kind && bookingIds.includes(r.bookingId)).map((r) => [r.bookingId, r.status])));
  }
  async sharedFinalAppointments(_trx: FakeTrx, bookings: { clinicId: string; bookingId: string }[]): Promise<Set<string>> {
    return Promise.resolve(
      new Set([...this.reports.values()].filter((r) => r.bookingKind === "APPOINTMENT" && r.status === "FINAL" && r.sharedWithPatient && bookings.some((b) => b.clinicId === r.clinicId && b.bookingId === r.bookingId)).map((r) => r.bookingId)),
    );
  }
}

export class FakeBookingSource implements BookingSourcePort<FakeTrx> {
  private readonly bookings = new Map<string, BookingFacts>();
  seed(kind: ConsultationBookingKind, bookingId: string, clinicId: string, facts: Partial<BookingFacts> = {}): void {
    this.bookings.set(`${clinicId}|${kind}|${bookingId}`, { status: "SCHEDULED", patientName: "Maria Silva", consultationAt: new Date("2026-11-08T09:30:00Z"), specialty: "Medicina Geral", slotId: "slot-1", ...facts });
  }
  setStatus(kind: ConsultationBookingKind, bookingId: string, clinicId: string, status: string): void {
    const key = `${clinicId}|${kind}|${bookingId}`;
    const facts = this.bookings.get(key);
    if (facts) this.bookings.set(key, { ...facts, status });
  }
  async find(_trx: FakeTrx, clinicId: string, kind: ConsultationBookingKind, bookingId: string): Promise<BookingFacts | null> {
    return Promise.resolve(this.bookings.get(`${clinicId}|${kind}|${bookingId}`) ?? null);
  }
}

export class FakeFamilyAppointments implements FamilyAppointmentLookupPort<FakeTrx> {
  private readonly appointments = new Map<string, { clinicId: string }>();
  seed(familyId: string, memberId: string, appointmentId: string, clinicId: string): void {
    this.appointments.set(`${familyId}|${memberId}|${appointmentId}`, { clinicId });
  }
  async find(_trx: FakeTrx, familyId: string, memberId: string, appointmentId: string): Promise<{ clinicId: string } | null> {
    return Promise.resolve(this.appointments.get(`${familyId}|${memberId}|${appointmentId}`) ?? null);
  }
}

export class FakeProfile implements ClinicProfileReaderPort<FakeTrx> {
  issuer: ReportIssuer = { name: "Clínica Sol", address: "Rua 1", phone: null, email: null };
  async get(): Promise<{ issuer: ReportIssuer }> {
    return Promise.resolve({ issuer: this.issuer });
  }
}

export class FakeProfessionals implements ProfessionalReaderPort<FakeTrx> {
  /** `clinicId|professionalId -> nome`. */
  readonly names = new Map<string, string>();
  /** `clinicId|slotId -> professionalId`. */
  readonly slots = new Map<string, string | null>();
  async findName(_trx: FakeTrx, clinicId: string, professionalId: string): Promise<string | null> {
    return Promise.resolve(this.names.get(`${clinicId}|${professionalId}`) ?? null);
  }
  async professionalOfSlot(_trx: FakeTrx, clinicId: string, slotId: string): Promise<{ professionalId: string | null; name: string | null } | null> {
    const key = `${clinicId}|${slotId}`;
    if (!this.slots.has(key)) return Promise.resolve(null);
    const professionalId = this.slots.get(key) ?? null;
    return Promise.resolve({ professionalId, name: professionalId ? (this.names.get(`${clinicId}|${professionalId}`) ?? null) : null });
  }
}

/** `relations`: `userId:memberId -> relação`; só SELF e TUTOR_OF leem; sem entrada => NOT_FOUND (membro de outra família). */
export class FakePatientAccess implements PatientAccessPort<FakeTrx> {
  readonly relations = new Map<string, "SELF" | "TUTOR_OF" | "DEPENDENT_SELF" | "OTHER">();
  async assertCanReadReport(_trx: FakeTrx, actor: ActorIdentity, _familyId: string, memberId: string): Promise<{ relation: "SELF" | "TUTOR_OF" }> {
    const relation = this.relations.get(`${actor.userId}:${memberId}`);
    if (!relation) throw new NotFoundError();
    if (relation !== "SELF" && relation !== "TUTOR_OF") throw new ForbiddenError({ detail: "Sem permissão sobre o relatório da consulta deste membro." });
    return Promise.resolve({ relation });
  }
  async assertCanViewExamOrders(_trx: FakeTrx, actor: ActorIdentity, _familyId: string, memberId: string): Promise<{ relation: "SELF" | "TUTOR_OF" }> {
    const relation = this.relations.get(`${actor.userId}:${memberId}`);
    if (!relation) throw new NotFoundError();
    if (relation !== "SELF" && relation !== "TUTOR_OF") throw new ForbiddenError({ detail: "Sem permissão sobre os pedidos de exame deste membro." });
    return Promise.resolve({ relation });
  }
}

interface FakeLink {
  orderId: string;
  familyId: string;
  memberId: string;
  appointmentId: string;
  examinationId: string | null;
  createdAt: Date;
}

/** Fake de `ExamOrdersRepository` com as mesmas regras de visibilidade/transição do repositório Kysely. */
export class FakeExamOrdersRepository implements ExamOrdersRepository<FakeTrx> {
  readonly orders = new Map<string, ExamOrder>();
  readonly links = new Map<string, FakeLink>();
  locked: string[] = [];

  async lockBooking(_trx: FakeTrx, bookingId: string): Promise<void> {
    this.locked.push(bookingId);
    return Promise.resolve();
  }
  async countActive(_trx: FakeTrx, clinicId: string, bookingId: string): Promise<number> {
    return Promise.resolve([...this.orders.values()].filter((o) => o.clinicId === clinicId && o.bookingId === bookingId && o.status !== "CANCELLED").length);
  }
  async insert(_trx: FakeTrx, r: NewExamOrderRecord): Promise<ExamOrder> {
    const order: ExamOrder = {
      id: r.id,
      clinicId: r.clinicId,
      bookingKind: r.bookingKind,
      bookingId: r.bookingId,
      clinicPatientId: r.clinicPatientId,
      name: r.name,
      serviceTypeId: r.serviceTypeId,
      note: r.note,
      urgent: r.urgent,
      status: "ORDERED",
      bookedHere: false,
      patientName: r.patientName,
      patientBirthDate: r.patientBirthDate,
      consultationAt: r.consultationAt,
      authorName: r.authorName,
      authorAccountId: r.authorAccountId,
      cancelledAt: null,
      createdAt: r.now,
      updatedAt: r.now,
    };
    this.orders.set(order.id, order);
    return Promise.resolve(order);
  }
  async insertLink(_trx: FakeTrx, link: NewExamOrderLink, now: Date): Promise<void> {
    this.links.set(link.orderId, { ...link, examinationId: null, createdAt: now });
    return Promise.resolve();
  }
  async listByBooking(_trx: FakeTrx, clinicId: string, bookingId: string): Promise<ExamOrder[]> {
    return Promise.resolve([...this.orders.values()].filter((o) => o.clinicId === clinicId && o.bookingId === bookingId));
  }
  async findById(_trx: FakeTrx, clinicId: string, bookingId: string, orderId: string): Promise<ExamOrder | null> {
    const order = this.orders.get(orderId);
    return Promise.resolve(order?.clinicId === clinicId && order.bookingId === bookingId ? order : null);
  }
  async cancel(_trx: FakeTrx, clinicId: string, orderId: string, _accountId: string, now: Date): Promise<ExamOrder> {
    const order = this.orders.get(orderId);
    if (order?.clinicId !== clinicId) throw new NotFoundError();
    const cancelled: ExamOrder = { ...order, status: "CANCELLED", bookedHere: false, cancelledAt: now, updatedAt: now };
    this.orders.set(orderId, cancelled);
    const link = this.links.get(orderId);
    if (link) link.examinationId = null;
    return Promise.resolve(cancelled);
  }
  async activeCountsByBookings(_trx: FakeTrx, clinicId: string, bookingIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const o of this.orders.values()) {
      if (o.clinicId === clinicId && o.status !== "CANCELLED" && bookingIds.includes(o.bookingId)) counts.set(o.bookingId, (counts.get(o.bookingId) ?? 0) + 1);
    }
    return Promise.resolve(counts);
  }
  async activeCountsByAppointments(_trx: FakeTrx, appointmentIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const link of this.links.values()) {
      if (this.orders.get(link.orderId)?.status !== "CANCELLED" && appointmentIds.includes(link.appointmentId)) counts.set(link.appointmentId, (counts.get(link.appointmentId) ?? 0) + 1);
    }
    return Promise.resolve(counts);
  }
  async listForMember(_trx: FakeTrx, familyId: string, memberId: string, filter: { status?: ExamOrderStatus; appointmentId?: string }): Promise<FamilyExamOrderRow[]> {
    const rows: FamilyExamOrderRow[] = [];
    for (const link of this.links.values()) {
      const order = this.orders.get(link.orderId);
      if (!order || link.familyId !== familyId || link.memberId !== memberId) continue;
      if (filter.status ? order.status !== filter.status : order.status === "CANCELLED") continue;
      if (filter.appointmentId && link.appointmentId !== filter.appointmentId) continue;
      rows.push({ id: order.id, appointmentId: link.appointmentId, clinicId: order.clinicId, name: order.name, note: order.note, urgent: order.urgent, status: order.status, examinationId: link.examinationId, createdAt: order.createdAt });
    }
    return Promise.resolve(rows);
  }
  async findLinkedForUpdate(_trx: FakeTrx, familyId: string, memberId: string, orderId: string): Promise<{ order: ExamOrder; examinationId: string | null } | null> {
    const link = this.links.get(orderId);
    const order = this.orders.get(orderId);
    return Promise.resolve(link && order && link.familyId === familyId && link.memberId === memberId ? { order, examinationId: link.examinationId } : null);
  }
  async setLinked(_trx: FakeTrx, orderId: string, examinationId: string, status: "SCHEDULED" | "FULFILLED", bookedHere: boolean, now: Date): Promise<void> {
    const link = this.links.get(orderId);
    const order = this.orders.get(orderId);
    if (!link || !order) throw new NotFoundError();
    link.examinationId = examinationId;
    this.orders.set(orderId, { ...order, status, bookedHere, updatedAt: now });
    return Promise.resolve();
  }
  async releaseByExamination(_trx: FakeTrx, examinationId: string, now: Date): Promise<string | null> {
    const link = [...this.links.values()].find((l) => l.examinationId === examinationId);
    if (!link) return Promise.resolve(null);
    link.examinationId = null;
    const order = this.orders.get(link.orderId);
    if (order && order.status !== "CANCELLED") this.orders.set(order.id, { ...order, status: "ORDERED", bookedHere: false, updatedAt: now });
    return Promise.resolve(link.orderId);
  }
  async fulfilByExamination(_trx: FakeTrx, examinationId: string, now: Date): Promise<string | null> {
    const link = [...this.links.values()].find((l) => l.examinationId === examinationId);
    if (!link) return Promise.resolve(null);
    const order = this.orders.get(link.orderId);
    if (order && order.status !== "CANCELLED") this.orders.set(order.id, { ...order, status: "FULFILLED", updatedAt: now });
    return Promise.resolve(link.orderId);
  }
}

export class FakeExamOrderAlerts implements ExamOrderAlertsPort<FakeTrx> {
  readonly raised: { appointmentId: string; familyId: string; memberId: string }[] = [];
  async raiseExamOrderAdded(_trx: FakeTrx, input: { appointmentId: string; familyId: string; memberId: string }): Promise<void> {
    this.raised.push(input);
    return Promise.resolve();
  }
}

/** `clinicId|serviceTypeId -> serviço`. */
export class FakeExamServices implements ExamServiceCatalogPort<FakeTrx> {
  readonly services = new Map<string, { id: string; name: string; kind: "APPOINTMENT" | "EXAM"; active: boolean }>();
  async find(_trx: FakeTrx, clinicId: string, serviceTypeId: string): Promise<{ id: string; name: string; kind: "APPOINTMENT" | "EXAM"; active: boolean } | null> {
    return Promise.resolve(this.services.get(`${clinicId}|${serviceTypeId}`) ?? null);
  }
}

export class FakePdfRenderer implements PdfRendererPort {
  readonly rendered: PdfDocument[] = [];
  failWith: Error | null = null;
  async render(document: PdfDocument): Promise<Buffer> {
    if (this.failWith) throw this.failWith;
    this.rendered.push(document);
    return Promise.resolve(Buffer.from("%PDF-1.4 fake"));
  }
}

export interface ClinicReportsFixtures {
  deps: ClinicReportsDeps<FakeTrx>;
  reportsRepo: FakeReportsRepository;
  bookings: FakeBookingSource;
  familyAppointments: FakeFamilyAppointments;
  profile: FakeProfile;
  professionals: FakeProfessionals;
  patientAccess: FakePatientAccess;
  pdf: FakePdfRenderer;
  audit: FakeAuditPort;
  ordersRepo: FakeExamOrdersRepository;
  orderAlerts: FakeExamOrderAlerts;
  services: FakeExamServices;
}

export function createClinicReportsFixtures(clock: Clock): ClinicReportsFixtures {
  const reportsRepo = new FakeReportsRepository();
  const bookings = new FakeBookingSource();
  const familyAppointments = new FakeFamilyAppointments();
  const profile = new FakeProfile();
  const professionals = new FakeProfessionals();
  const patientAccess = new FakePatientAccess();
  const pdf = new FakePdfRenderer();
  const audit = new FakeAuditPort();
  const ordersRepo = new FakeExamOrdersRepository();
  const orderAlerts = new FakeExamOrderAlerts();
  const services = new FakeExamServices();
  const deps: ClinicReportsDeps<FakeTrx> = {
    ordersRepo,
    orderAlerts,
    services,
    reportsRepo,
    bookings,
    familyAppointments,
    profile,
    professionals,
    patientAccess,
    pdf,
    audit,
    withTransaction: (fn) => fn(FAKE_TRX),
    limiter: new InMemoryRateLimiter(clock),
    clock,
  };
  return { deps, reportsRepo, bookings, familyAppointments, profile, professionals, patientAccess, pdf, audit, ordersRepo, orderAlerts, services };
}
