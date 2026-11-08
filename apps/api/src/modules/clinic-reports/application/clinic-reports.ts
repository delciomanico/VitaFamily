// Casos de uso do portal da clínica sobre o relatório da consulta (UC-CLN-32..35, BR-CLN-41..44/46, M15 S, ADR-027).
// Autorização: matriz papel × rota do portal (middleware de `clinics`) + defesa em profundidade aqui (só o Médico escreve;
// o Médico só age nas marcações do seu profissional). Isolamento: tudo filtra pela clínica do token (404 sem enumeração).
// O texto do relatório é dado de saúde: nunca em auditoria, logs nem erros.
import { DomainError, NotFoundError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import {
  assertBookingAllowsReport,
  assertEditable,
  MAX_ADDENDA,
  parseAddendumInput,
  parseReportInput,
  resolveSharedWithPatient,
  type ConsultationBookingKind,
  type ConsultationReport,
  type ReportInput,
} from "../domain/consultation-report.js";
import { buildConsultationReportDocument, reportFilename } from "../domain/report-pdf.js";
import type { BookingFacts, ClinicPortalActor, ClinicReportsDeps, ReportRecord, RequestContext } from "./ports.js";
import { assertCanWrite, assertInScope, authorNameOf, clinicAudit, consumeLimit, resolveBooking, sectionsCountOf, toClinicView, type ClinicConsultationReportView } from "./support.js";

/** `upsert` devolve `null` se o relatório já era `FINAL` (escrita concorrente): BR-CLN-42/43. */
function requireSaved(saved: ConsultationReport | null): ConsultationReport {
  if (!saved) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "O relatório final é imutável; acrescente uma adenda." });
  return saved;
}

function snapshotOf(facts: BookingFacts) {
  return {
    clinicPatientId: facts.clinicPatientId ?? null,
    patientName: facts.patientName.slice(0, 120),
    patientBirthDate: facts.patientBirthDate ?? null,
    consultationAt: facts.consultationAt,
    specialty: facts.specialty ? facts.specialty.slice(0, 80) : null,
  };
}

function toRecord(
  actor: ClinicPortalActor,
  kind: ConsultationBookingKind,
  bookingId: string,
  facts: BookingFacts,
  existing: ConsultationReport | null,
  sections: Pick<ReportInput, "reason" | "findings" | "impression" | "plan">,
  sharedWithPatient: boolean | undefined,
  authorName: string,
  finalize: { issuer: NonNullable<ReportRecord["issuer"]> } | null,
  now: Date,
): ReportRecord {
  return {
    id: existing?.id ?? newId(),
    clinicId: actor.clinicId,
    bookingKind: kind,
    bookingId,
    ...snapshotOf(facts),
    status: finalize ? "FINAL" : "DRAFT",
    reason: sections.reason,
    findings: sections.findings,
    impression: sections.impression,
    plan: sections.plan,
    sharedWithPatient: resolveSharedWithPatient(kind, sharedWithPatient, existing?.sharedWithPatient),
    authorName,
    issuer: finalize?.issuer ?? null,
    authorAccountId: actor.clinicAccountId,
    finalizedAt: finalize ? now : null,
    now,
  };
}

/** `PUT /clinic-portal/agenda/{id}/report` (UC-CLN-32): cria/atualiza o rascunho (última escrita ganha). */
export function createSaveReportUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function saveReport(actor: ClinicPortalActor, bookingId: string, body: unknown, context: RequestContext): Promise<ClinicConsultationReportView> {
    const professionalId = assertCanWrite(actor);
    consumeLimit(deps.limiter, "write", actor.clinicAccountId);
    const input = parseReportInput(body);

    return deps.withTransaction(async (trx) => {
      const booking = await resolveBooking(deps, trx, actor.clinicId, bookingId);
      if (!booking) throw new NotFoundError({ detail: "Marcação não encontrada." });
      await assertInScope(deps, trx, actor, booking.facts);
      assertBookingAllowsReport(booking.facts.status);
      const existing = await deps.reportsRepo.findByBooking(trx, actor.clinicId, booking.kind, bookingId, true);
      assertEditable(existing);

      const now = deps.clock.now();
      const authorName = await authorNameOf(deps, trx, actor, professionalId);
      const saved = await deps.reportsRepo.upsert(trx, toRecord(actor, booking.kind, bookingId, booking.facts, existing, input, input.sharedWithPatient, authorName, null, now));
      const report = requireSaved(saved);
      await deps.audit.record(trx, clinicAudit(actor, now, "CONSULT_REPORT_SAVED", report.id, context, { bookingKind: booking.kind, sectionsCount: sectionsCountOf(report) }));
      return toClinicView(report);
    });
  };
}

/** `PUT /clinic-portal/agenda/{id}/report/finalize` (UC-CLN-33): `DRAFT -> FINAL`, idempotente. */
export function createFinalizeReportUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function finalizeReport(actor: ClinicPortalActor, bookingId: string, context: RequestContext): Promise<ClinicConsultationReportView> {
    const professionalId = assertCanWrite(actor);
    consumeLimit(deps.limiter, "write", actor.clinicAccountId);

    return deps.withTransaction(async (trx) => {
      const booking = await resolveBooking(deps, trx, actor.clinicId, bookingId);
      if (!booking) throw new NotFoundError({ detail: "Marcação não encontrada." });
      await assertInScope(deps, trx, actor, booking.facts);
      const existing = await deps.reportsRepo.findByBooking(trx, actor.clinicId, booking.kind, bookingId, true);
      if (!existing) throw new NotFoundError({ detail: "Relatório não encontrado." });
      if (existing.status === "FINAL") return toClinicView(existing);
      assertBookingAllowsReport(booking.facts.status);

      const now = deps.clock.now();
      const { issuer } = await deps.profile.get(trx, actor.clinicId);
      const authorName = await authorNameOf(deps, trx, actor, professionalId);
      const saved = await deps.reportsRepo.upsert(trx, toRecord(actor, booking.kind, bookingId, booking.facts, existing, existing, undefined, authorName, { issuer }, now));
      const report = requireSaved(saved);
      await deps.audit.record(trx, clinicAudit(actor, now, "CONSULT_REPORT_FINALIZED", report.id, context, { bookingKind: booking.kind, sharedWithPatient: report.sharedWithPatient, viaComplete: false }));
      return toClinicView(report);
    });
  };
}

/**
 * `report` em `PUT /clinic-portal/agenda/{id}/complete` (BR-CLN-42): grava e finaliza NA transação da conclusão (`trx` do
 * chamador). Admin/Gestor => `FORBIDDEN` (a transação do chamador reverte: sem efeito parcial). Implementa a porta
 * `ConsultationReportFinalizer` de `appointments` (ligada em `main/api.ts`; nenhuma aresta `appointments` -> `clinic-reports`).
 */
export function createFinalizeWithCompleteUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function finalizeWithComplete(trx: Trx, actor: ClinicPortalActor, kind: ConsultationBookingKind, bookingId: string, body: unknown, context: RequestContext): Promise<void> {
    const professionalId = assertCanWrite(actor);
    const input = parseReportInput(body);
    const facts = await deps.bookings.find(trx, actor.clinicId, kind, bookingId);
    if (!facts) throw new NotFoundError({ detail: "Marcação não encontrada." });
    await assertInScope(deps, trx, actor, facts);
    assertBookingAllowsReport(facts.status);
    const existing = await deps.reportsRepo.findByBooking(trx, actor.clinicId, kind, bookingId, true);
    assertEditable(existing);

    const now = deps.clock.now();
    const { issuer } = await deps.profile.get(trx, actor.clinicId);
    const authorName = await authorNameOf(deps, trx, actor, professionalId);
    const saved = await deps.reportsRepo.upsert(trx, toRecord(actor, kind, bookingId, facts, existing, input, input.sharedWithPatient, authorName, { issuer }, now));
    const report = requireSaved(saved);
    await deps.audit.record(trx, clinicAudit(actor, now, "CONSULT_REPORT_FINALIZED", report.id, context, { bookingKind: kind, sharedWithPatient: report.sharedWithPatient, viaComplete: true }));
  };
}

/** `POST /clinic-portal/agenda/{id}/report/addenda` (UC-CLN-34): adenda imutável, até 20, só sobre `FINAL`. */
export function createAddAddendumUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function addAddendum(actor: ClinicPortalActor, bookingId: string, body: unknown, context: RequestContext): Promise<ClinicConsultationReportView> {
    const professionalId = assertCanWrite(actor);
    consumeLimit(deps.limiter, "write", actor.clinicAccountId);
    const text = parseAddendumInput(body);

    return deps.withTransaction(async (trx) => {
      const booking = await resolveBooking(deps, trx, actor.clinicId, bookingId);
      if (!booking) throw new NotFoundError({ detail: "Marcação não encontrada." });
      await assertInScope(deps, trx, actor, booking.facts);
      // `FOR UPDATE` da linha do relatório serializa adendas concorrentes (limite de 20 validado sob o bloqueio).
      const report = await deps.reportsRepo.findByBooking(trx, actor.clinicId, booking.kind, bookingId, true);
      if (!report) throw new NotFoundError({ detail: "Relatório não encontrado." });
      if (report.status !== "FINAL") throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A adenda só se acrescenta a um relatório final; edite o rascunho." });
      if ((await deps.reportsRepo.countAddenda(trx, actor.clinicId, report.id)) >= MAX_ADDENDA) {
        throw new DomainError("LIMIT_EXCEEDED", { detail: `Máximo de ${String(MAX_ADDENDA)} adendas por relatório.` });
      }
      const now = deps.clock.now();
      const authorName = await authorNameOf(deps, trx, actor, professionalId);
      await deps.reportsRepo.insertAddendum(trx, { id: newId(), clinicId: actor.clinicId, reportId: report.id, text, authorName, authorAccountId: actor.clinicAccountId, createdAt: now });
      const updated = await deps.reportsRepo.findByBooking(trx, actor.clinicId, booking.kind, bookingId);
      await deps.audit.record(trx, clinicAudit(actor, now, "CONSULT_REPORT_AMENDED", report.id, context, { bookingKind: booking.kind, addendaCount: (updated?.addenda.length ?? report.addenda.length + 1) }));
      return toClinicView(updated ?? report);
    });
  };
}

/** Marcação resolvida + relatório (UC-CLN-35): Admin/Gestor leem qualquer marcação da clínica; o Médico as suas. */
async function loadReadable<Trx>(deps: ClinicReportsDeps<Trx>, trx: Trx, actor: ClinicPortalActor, bookingId: string): Promise<ConsultationReport> {
  const booking = await resolveBooking(deps, trx, actor.clinicId, bookingId);
  let report: ConsultationReport | null;
  if (booking) {
    await assertInScope(deps, trx, actor, booking.facts);
    report = await deps.reportsRepo.findByBooking(trx, actor.clinicId, booking.kind, bookingId);
  } else {
    // Marcação Vita já apagada: o relatório sobrevive (BR-CLN-50); o Médico não consegue provar o âmbito => 404.
    if (actor.role === "CLINIC_DOCTOR") throw new NotFoundError({ detail: "Marcação não encontrada." });
    report = await deps.reportsRepo.findByBookingId(trx, actor.clinicId, bookingId);
  }
  if (!report) throw new NotFoundError({ detail: "Relatório não encontrado." });
  return report;
}

/** `GET /clinic-portal/agenda/{id}/report` (UC-CLN-35). Leitura auditada (`CONSULT_REPORT_VIEWED`, sem texto). */
export function createGetReportUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function getReport(actor: ClinicPortalActor, bookingId: string, context: RequestContext): Promise<ClinicConsultationReportView> {
    return deps.withTransaction(async (trx) => {
      const report = await loadReadable(deps, trx, actor, bookingId);
      await deps.audit.record(trx, clinicAudit(actor, deps.clock.now(), "CONSULT_REPORT_VIEWED", report.id, context, { bookingKind: report.bookingKind, format: "JSON" }));
      return toClinicView(report);
    });
  };
}

export interface GeneratedPdf {
  bytes: Buffer;
  filename: string;
}

/** `GET /clinic-portal/agenda/{id}/report/pdf` (BR-CLN-46): gerado a pedido, não é guardado; 30/min por conta. */
export function createGetReportPdfUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function getReportPdf(actor: ClinicPortalActor, bookingId: string, context: RequestContext): Promise<GeneratedPdf> {
    consumeLimit(deps.limiter, "pdf", actor.clinicAccountId);
    return deps.withTransaction(async (trx) => {
      const report = await loadReadable(deps, trx, actor, bookingId);
      // O `FINAL` usa o retrato do perfil; o `DRAFT` o perfil atual (BR-CLN-46).
      const issuer = report.issuer ?? (await deps.profile.get(trx, actor.clinicId)).issuer;
      const now = deps.clock.now();
      const bytes = await deps.pdf.render(buildConsultationReportDocument(report, issuer, now));
      await deps.audit.record(trx, clinicAudit(actor, now, "CONSULT_REPORT_VIEWED", report.id, context, { bookingKind: report.bookingKind, format: "PDF" }));
      return { bytes, filename: reportFilename(report.consultationAt) };
    });
  };
}

/** Estados dos relatórios das marcações (decora `ClinicBooking.reportStatus`); API pública para `appointments`. */
export function createReportStatusesUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return function reportStatuses(trx: Trx, clinicId: string, kind: ConsultationBookingKind, bookingIds: string[]) {
    return bookingIds.length === 0 ? Promise.resolve(new Map<string, "DRAFT" | "FINAL">()) : deps.reportsRepo.statusesByBookings(trx, clinicId, kind, bookingIds);
  };
}

/** Consultas Vita com relatório FINAL partilhado (decora `Appointment.reportAvailable`); API pública para `appointments`. */
export function createSharedReportAvailabilityUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return function sharedReportAvailability(trx: Trx, bookings: { clinicId: string; bookingId: string }[]) {
    return bookings.length === 0 ? Promise.resolve(new Set<string>()) : deps.reportsRepo.sharedFinalAppointments(trx, bookings);
  };
}
