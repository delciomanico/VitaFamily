import { ForbiddenError, NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import type { RateLimiter } from "../../../platform/rate-limit/index.js";
import { auditContextFields, type AuditEvent } from "../../audit/index.js";
import { countSections, type ConsultationBookingKind, type ConsultationReport } from "../domain/consultation-report.js";
import type { BookingFacts, ClinicPortalActor, ClinicReportsDeps, RequestContext } from "./ports.js";

export const WRITE_LIMIT = { max: 60, windowMs: 60_000 };
export const PDF_LIMIT = { max: 30, windowMs: 60_000 };

export function consumeLimit(limiter: RateLimiter, kind: "write" | "pdf", accountId: string): void {
  const decision = limiter.consume(`consult-report-${kind}:${accountId}`, kind === "write" ? WRITE_LIMIT : PDF_LIMIT);
  if (!decision.allowed) {
    throw new RateLimitedError(decision.retryAfterMs, { detail: "Demasiados pedidos; tente mais tarde." });
  }
}

/** BR-CLN-44: só o `CLINIC_DOCTOR` escreve; Admin e Gestor => `FORBIDDEN` (sem efeito parcial). */
export function assertCanWrite(actor: ClinicPortalActor): string {
  if (actor.role !== "CLINIC_DOCTOR" || !actor.professionalId) {
    throw new ForbiddenError({ detail: "Só o médico escreve o relatório da consulta." });
  }
  return actor.professionalId;
}

/** Marcação da clínica pelo id (despacho consulta/visita pelo id, BR-CLN-18). */
export async function resolveBooking<Trx>(deps: ClinicReportsDeps<Trx>, trx: Trx, clinicId: string, bookingId: string): Promise<{ kind: ConsultationBookingKind; facts: BookingFacts } | null> {
  for (const kind of ["APPOINTMENT", "VISIT"] as const) {
    const facts = await deps.bookings.find(trx, clinicId, kind, bookingId);
    if (facts) return { kind, facts };
  }
  return null;
}

/** BR-CLN-44: o Médico só age em marcações do seu profissional (`clinic_slots.professional_id`); sem horário => `NOT_FOUND`. */
export async function assertInScope<Trx>(deps: ClinicReportsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, facts: BookingFacts): Promise<void> {
  if (actor.role !== "CLINIC_DOCTOR") return;
  if (!actor.professionalId || !facts.slotId) throw new NotFoundError({ detail: "Marcação não encontrada." });
  const slot = await deps.professionals.professionalOfSlot(trx, actor.clinicId, facts.slotId);
  if (slot?.professionalId !== actor.professionalId) throw new NotFoundError({ detail: "Marcação não encontrada." });
}

export async function authorNameOf<Trx>(deps: ClinicReportsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, professionalId: string): Promise<string> {
  const name = await deps.professionals.findName(trx, actor.clinicId, professionalId);
  if (!name) throw new NotFoundError({ detail: "Profissional não encontrado." });
  return name;
}

/** Auditoria da clínica (audit.md §3): só ids e contagens; NUNCA texto, nomes nem diagnóstico. */
export function clinicAudit(
  actor: ClinicPortalActor,
  now: Date,
  action: Extract<AuditEvent["action"], "CONSULT_REPORT_SAVED" | "CONSULT_REPORT_FINALIZED" | "CONSULT_REPORT_AMENDED" | "CONSULT_REPORT_VIEWED">,
  reportId: string,
  context: RequestContext,
  metadata: Record<string, string | number | boolean | null>,
): AuditEvent {
  return {
    occurredAt: now,
    actorType: "CLINIC_ACCOUNT",
    actorClinicAccountId: actor.clinicAccountId,
    actorClinicId: actor.clinicId,
    action,
    resourceType: "ConsultationReport",
    resourceId: reportId,
    result: "SUCCESS",
    requestId: context.requestId,
    ...auditContextFields(context),
    metadata,
  };
}

export interface ClinicConsultationReportView {
  id: string;
  bookingKind: ConsultationBookingKind;
  bookingId: string;
  status: "DRAFT" | "FINAL";
  reason: string | null;
  findings: string | null;
  impression: string | null;
  plan: string | null;
  sharedWithPatient: boolean;
  patientName: string;
  patientBirthDate: string | null;
  consultationAt: string;
  specialty: string | null;
  authorName: string;
  authorAccountId: string | null;
  finalizedAt: string | null;
  addenda: { id: string; text: string; authorName: string; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
}

/** `components.schemas.ConsultationReport` (visão da clínica). */
export function toClinicView(report: ConsultationReport): ClinicConsultationReportView {
  return {
    id: report.id,
    bookingKind: report.bookingKind,
    bookingId: report.bookingId,
    status: report.status,
    reason: report.reason,
    findings: report.findings,
    impression: report.impression,
    plan: report.plan,
    sharedWithPatient: report.sharedWithPatient,
    patientName: report.patientName,
    patientBirthDate: report.patientBirthDate,
    consultationAt: report.consultationAt.toISOString(),
    specialty: report.specialty,
    authorName: report.authorName,
    authorAccountId: report.authorAccountId,
    finalizedAt: report.finalizedAt?.toISOString() ?? null,
    addenda: report.addenda.map((a) => ({ id: a.id, text: a.text, authorName: a.authorName, createdAt: a.createdAt.toISOString() })),
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

export function sectionsCountOf(report: Pick<ConsultationReport, "reason" | "findings" | "impression" | "plan">): number {
  return countSections(report);
}
