// Controllers HTTP de `/clinic-portal/agenda/{id}/report*` (openapi.yaml operationIds: getClinicConsultationReport,
// saveClinicConsultationReport, finalizeClinicConsultationReport, addClinicConsultationReportAddendum,
// getClinicConsultationReportPdf — tag "Clinic Portal", M15 S, ADR-027). O ator vem de `platform/actor` (`getClinicActor`,
// ADR-020): nunca `AccessPolicy`/`User`. A matriz papel × rota (authorization.md §6.2b) é do middleware do portal (`clinics`).
import { Router, type Response } from "express";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import type { GeneratedPdf } from "../application/clinic-reports.js";
import type { ClinicExamOrderView } from "../application/exam-orders.js";
import type { ClinicPortalActor } from "../application/ports.js";
import type { ClinicConsultationReportView } from "../application/support.js";

export interface ClinicReportsPortalController {
  getClinicConsultationReport: (actor: ClinicPortalActor, bookingId: string, context: RequestContext) => Promise<ClinicConsultationReportView>;
  saveClinicConsultationReport: (actor: ClinicPortalActor, bookingId: string, body: unknown, context: RequestContext) => Promise<ClinicConsultationReportView>;
  finalizeClinicConsultationReport: (actor: ClinicPortalActor, bookingId: string, context: RequestContext) => Promise<ClinicConsultationReportView>;
  addClinicConsultationReportAddendum: (actor: ClinicPortalActor, bookingId: string, body: unknown, context: RequestContext) => Promise<ClinicConsultationReportView>;
  getClinicConsultationReportPdf: (actor: ClinicPortalActor, bookingId: string, context: RequestContext) => Promise<GeneratedPdf>;
  /** M15 U/V (ADR-028): pedido de exame e declaração de presença. */
  listClinicExamOrders: (actor: ClinicPortalActor, bookingId: string, context: RequestContext) => Promise<ClinicExamOrderView[]>;
  createClinicExamOrders: (actor: ClinicPortalActor, bookingId: string, body: unknown, context: RequestContext) => Promise<ClinicExamOrderView[]>;
  cancelClinicExamOrder: (actor: ClinicPortalActor, bookingId: string, orderId: string, context: RequestContext) => Promise<ClinicExamOrderView>;
  getClinicExamOrdersPdf: (actor: ClinicPortalActor, bookingId: string, context: RequestContext) => Promise<GeneratedPdf>;
  getClinicAttendanceStatementPdf: (actor: ClinicPortalActor, bookingId: string, includeProfessional: boolean, context: RequestContext) => Promise<GeneratedPdf>;
}

function sendPdf(res: Response, pdf: GeneratedPdf): void {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Content-Disposition", `inline; filename="${pdf.filename}"`);
  res.send(pdf.bytes);
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
      sendPdf(res, await controller.getClinicConsultationReportPdf(requireClinicPortalActor(), requireParam(req, "appointmentId"), buildRequestContext(req)));
    }),
  );

  const orders = "/clinic-portal/agenda/:appointmentId/exam-orders";

  router.get(
    orders,
    asyncHandler(async (req, res) => {
      res.json({ items: await controller.listClinicExamOrders(requireClinicPortalActor(), requireParam(req, "appointmentId"), buildRequestContext(req)) });
    }),
  );

  router.post(
    orders,
    asyncHandler(async (req, res) => {
      res.status(201).json({ items: await controller.createClinicExamOrders(requireClinicPortalActor(), requireParam(req, "appointmentId"), req.body, buildRequestContext(req)) });
    }),
  );

  router.put(
    `${orders}/:orderId/cancel`,
    asyncHandler(async (req, res) => {
      res.json(await controller.cancelClinicExamOrder(requireClinicPortalActor(), requireParam(req, "appointmentId"), requireParam(req, "orderId"), buildRequestContext(req)));
    }),
  );

  router.get(
    `${orders}/pdf`,
    asyncHandler(async (req, res) => {
      sendPdf(res, await controller.getClinicExamOrdersPdf(requireClinicPortalActor(), requireParam(req, "appointmentId"), buildRequestContext(req)));
    }),
  );

  router.get(
    "/clinic-portal/agenda/:appointmentId/attendance-statement/pdf",
    asyncHandler(async (req, res) => {
      const includeProfessional = req.query.includeProfessional === "true" || (req.query.includeProfessional as unknown) === true;
      sendPdf(res, await controller.getClinicAttendanceStatementPdf(requireClinicPortalActor(), requireParam(req, "appointmentId"), includeProfessional, buildRequestContext(req)));
    }),
  );

  return router;
}
