// Controllers HTTP de `/clinic-portal/agenda/{id}/report*` (openapi.yaml operationIds: getClinicConsultationReport,
// saveClinicConsultationReport, finalizeClinicConsultationReport, addClinicConsultationReportAddendum,
// getClinicConsultationReportPdf — tag "Clinic Portal", M15 S, ADR-027). O ator vem de `platform/actor` (`getClinicActor`,
// ADR-020): nunca `AccessPolicy`/`User`. A matriz papel × rota (authorization.md §6.2b) é do middleware do portal (`clinics`).
import { Router } from "express";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import type { GeneratedPdf } from "../application/clinic-reports.js";
import type { ClinicPortalActor } from "../application/ports.js";
import type { ClinicConsultationReportView } from "../application/support.js";

export interface ClinicReportsPortalController {
  getClinicConsultationReport: (actor: ClinicPortalActor, bookingId: string, context: RequestContext) => Promise<ClinicConsultationReportView>;
  saveClinicConsultationReport: (actor: ClinicPortalActor, bookingId: string, body: unknown, context: RequestContext) => Promise<ClinicConsultationReportView>;
  finalizeClinicConsultationReport: (actor: ClinicPortalActor, bookingId: string, context: RequestContext) => Promise<ClinicConsultationReportView>;
  addClinicConsultationReportAddendum: (actor: ClinicPortalActor, bookingId: string, body: unknown, context: RequestContext) => Promise<ClinicConsultationReportView>;
  getClinicConsultationReportPdf: (actor: ClinicPortalActor, bookingId: string, context: RequestContext) => Promise<GeneratedPdf>;
}

function requireClinicPortalActor(): ClinicPortalActor {
  const actor = getClinicActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, role: actor.role, ...(actor.professionalId ? { professionalId: actor.professionalId } : {}) };
}

export function createClinicReportsPortalRouter(controller: ClinicReportsPortalController): Router {
  const router = Router();
  const base = "/clinic-portal/agenda/:appointmentId/report";

  router.get(
    base,
    asyncHandler(async (req, res) => {
      res.json(await controller.getClinicConsultationReport(requireClinicPortalActor(), requireParam(req, "appointmentId"), buildRequestContext(req)));
    }),
  );

  router.put(
    base,
    asyncHandler(async (req, res) => {
      res.json(await controller.saveClinicConsultationReport(requireClinicPortalActor(), requireParam(req, "appointmentId"), req.body, buildRequestContext(req)));
    }),
  );

  router.put(
    `${base}/finalize`,
    asyncHandler(async (req, res) => {
      res.json(await controller.finalizeClinicConsultationReport(requireClinicPortalActor(), requireParam(req, "appointmentId"), buildRequestContext(req)));
    }),
  );

  router.post(
    `${base}/addenda`,
    asyncHandler(async (req, res) => {
      res.status(201).json(await controller.addClinicConsultationReportAddendum(requireClinicPortalActor(), requireParam(req, "appointmentId"), req.body, buildRequestContext(req)));
    }),
  );

  router.get(
    `${base}/pdf`,
    asyncHandler(async (req, res) => {
      const pdf = await controller.getClinicConsultationReportPdf(requireClinicPortalActor(), requireParam(req, "appointmentId"), buildRequestContext(req));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `inline; filename="${pdf.filename}"`);
      res.send(pdf.bytes);
    }),
  );

  return router;
}
