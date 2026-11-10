// Declaração de presença (UC-CLN-43, BR-CLN-55, M15 V, ADR-028): PDF gerado a pedido, SEM guardar nada (sem número, sem
// `Document`); só a auditoria `ATTENDANCE_STATEMENT_ISSUED` (ids). Admin, Gestor e Médico (suas) a emitem; o paciente não.
import { NotFoundError } from "../../../platform/errors/index.js";
import { assertAttendanceEligible } from "../domain/exam-order.js";
import { attendanceStatementFilename, buildAttendanceStatementDocument } from "../domain/exam-order-pdf.js";
import type { GeneratedPdf } from "./clinic-reports.js";
import type { ClinicPortalActor, ClinicReportsDeps, RequestContext } from "./ports.js";
import { assertInScope, bookingResourceType, clinicOrderAudit, consumeLimit, resolveBooking } from "./support.js";

/** `GET /clinic-portal/agenda/{id}/attendance-statement/pdf?includeProfessional=`: bolsa de 30/min partilhada com os outros PDF. */
export function createGetAttendanceStatementPdfUseCase<Trx>(deps: ClinicReportsDeps<Trx>) {
  return async function getAttendanceStatementPdf(actor: ClinicPortalActor, bookingId: string, includeProfessional: boolean, context: RequestContext): Promise<GeneratedPdf> {
    consumeLimit(deps.limiter, "pdf", actor.clinicAccountId);
    return deps.withTransaction(async (trx) => {
      const booking = await resolveBooking(deps, trx, actor.clinicId, bookingId);
      if (!booking) throw new NotFoundError({ detail: "Marcação não encontrada." });
      await assertInScope(deps, trx, actor, booking.facts);
      assertAttendanceEligible(booking.facts.status, booking.facts.arrivedAt);
      const { issuer } = await deps.profile.get(trx, actor.clinicId);
      const professionalName =
        includeProfessional && booking.facts.slotId ? ((await deps.professionals.professionalOfSlot(trx, actor.clinicId, booking.facts.slotId))?.name ?? null) : null;
      const now = deps.clock.now();
      const bytes = await deps.pdf.render(buildAttendanceStatementDocument({ patientName: booking.facts.patientName, consultationAt: booking.facts.consultationAt, professionalName }, issuer, now));
      await deps.audit.record(trx, clinicOrderAudit(actor, now, "ATTENDANCE_STATEMENT_ISSUED", bookingResourceType(booking.kind), bookingId, context, { bookingKind: booking.kind, includeProfessional }));
      return { bytes, filename: attendanceStatementFilename(booking.facts.consultationAt) };
    });
  };
}
