// Relatório da consulta — lado família (UC-CLN-36, BR-CLN-45/46, authorization.md §6.6, M15 S). Autorização pela porta
// `PatientAccessPort` (`AccessPolicy.can(VIEW_CONSULTATION_REPORT)`: só SELF adulto ou TUTOR_OF; DEPENDENT_SELF e OTHER =>
// FORBIDDEN mesmo com SharingGrant). NÃO depende de `ClinicConsent`. Só `FINAL`, partilhado, de consulta Vita da família;
// o resto => NOT_FOUND. Sem ids da clínica nem da conta autora.
import { NotFoundError } from "../../../platform/errors/index.js";
import { REPORT_NOTICE, type ConsultationReport } from "../domain/consultation-report.js";
import { buildConsultationReportDocument, reportFilename } from "../domain/report-pdf.js";
import type { ActorIdentity, ClinicReportsDeps, RequestContext } from "./ports.js";
import { auditContextFields } from "../../audit/index.js";
import type { GeneratedPdf } from "./clinic-reports.js";

export interface FamilyConsultationReportView {
  appointmentId: string;
  clinicName: string;
  consultationAt: string;
  specialty: string | null;
  authorName: string;
  reason: string | null;
  findings: string | null;
  impression: string | null;
  plan: string | null;
  finalizedAt: string;
  addenda: { id: string; text: string; authorName: string; createdAt: string }[];
  notice: string;
}

async function loadShared<Trx>(deps: ClinicReportsDeps<Trx>, trx: Trx, actor: ActorIdentity, familyId: string, memberId: string, appointmentId: string) {
  const access = await deps.patientAccess.assertCanReadReport(trx, actor, familyId, memberId);
  const appointment = await deps.familyAppointments.find(trx, familyId, memberId, appointmentId);
  if (!appointment) throw new NotFoundError({ detail: "Relatório não encontrado." });
  const report = await deps.reportsRepo.findByBooking(trx, appointment.clinicId, "APPOINTMENT", appointmentId);
  if (report?.status !== "FINAL" || !report.sharedWithPatient || !report.finalizedAt || !report.issuer) {
    throw new NotFoundError({ detail: "Relatório não encontrado." });
  }
  return { access, report: report as ConsultationReport & { finalizedAt: Date; issuer: NonNullable<ConsultationReport["issuer"]> } };
}

async function auditView<Trx>(deps: ClinicReportsDeps<Trx>, trx: Trx, actor: ActorIdentity, familyId: string, memberId: string, appointmentId: string, format: "JSON" | "PDF", context: RequestContext) {
  await deps.audit.record(trx, {
    occurredAt: deps.clock.now(),
    actorType: "USER",
    actorUserId: actor.userId,
    action: "CONSULT_REPORT_VIEWED",
    resourceType: "Appointment",
    resourceId: appointmentId,
    familyId,
    subjectMemberId: memberId,
    result: "SUCCESS",
    requestId: context.requestId,
    ...auditContextFields(context),
    metadata: { format },
  });
}

/** `GET /families/{f}/members/{m}/appointments/{id}/report`: a leitura do titular sobre o próprio não se audita; a do tutor sim. */
export function createGetFamilyReportUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function getFamilyReport(actor: ActorIdentity, familyId: string, memberId: string, appointmentId: string, context: RequestContext): Promise<FamilyConsultationReportView> {
    return deps.withTransaction(async (trx) => {
      const { access, report } = await loadShared(deps, trx, actor, familyId, memberId, appointmentId);
      if (access.relation !== "SELF") await auditView(deps, trx, actor, familyId, memberId, appointmentId, "JSON", context);
      return {
        appointmentId,
        clinicName: report.issuer.name,
        consultationAt: report.consultationAt.toISOString(),
        specialty: report.specialty,
        authorName: report.authorName,
        reason: report.reason,
        findings: report.findings,
        impression: report.impression,
        plan: report.plan,
        finalizedAt: report.finalizedAt.toISOString(),
        addenda: report.addenda.map((a) => ({ id: a.id, text: a.text, authorName: a.authorName, createdAt: a.createdAt.toISOString() })),
        notice: REPORT_NOTICE,
      };
    });
  };
}

/** `GET …/report/pdf`: o download do PDF é SEMPRE auditado (`CONSULT_REPORT_VIEWED`, `format=PDF`). */
export function createGetFamilyReportPdfUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function getFamilyReportPdf(actor: ActorIdentity, familyId: string, memberId: string, appointmentId: string, context: RequestContext): Promise<GeneratedPdf> {
    return deps.withTransaction(async (trx) => {
      const { report } = await loadShared(deps, trx, actor, familyId, memberId, appointmentId);
      const bytes = await deps.pdf.render(buildConsultationReportDocument(report, report.issuer, deps.clock.now()));
      await auditView(deps, trx, actor, familyId, memberId, appointmentId, "PDF", context);
      return { bytes, filename: reportFilename(report.consultationAt) };
    });
  };
}
