// Controllers HTTP do lado família (openapi.yaml operationIds: getFamilyConsultationReport, getFamilyConsultationReportPdf —
// tag "Appointments", M15 S, authorization.md §6.6). O ator é o `User`; a autorização é da porta `PatientAccessPort`.
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import type { GeneratedPdf } from "../application/clinic-reports.js";
import type { FamilyExamOrderView, ListFamilyExamOrdersQuery } from "../application/family-exam-orders.js";
import type { FamilyConsultationReportView } from "../application/family-reports.js";
import type { ActorIdentity } from "../application/ports.js";

export interface ClinicReportsFamilyController {
  getFamilyConsultationReport: (actor: ActorIdentity, familyId: string, memberId: string, appointmentId: string, context: RequestContext) => Promise<FamilyConsultationReportView>;
  getFamilyConsultationReportPdf: (actor: ActorIdentity, familyId: string, memberId: string, appointmentId: string, context: RequestContext) => Promise<GeneratedPdf>;
  /** M15 U (ADR-028, BR-CLN-53): pedidos de exame do membro (SELF/TUTOR_OF). */
  listFamilyExamOrders: (actor: ActorIdentity, familyId: string, memberId: string, query: ListFamilyExamOrdersQuery) => Promise<FamilyExamOrderView[]>;
}

const ORDER_STATUSES = new Set(["ORDERED", "SCHEDULED", "FULFILLED", "CANCELLED"]);

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

export function createClinicReportsFamilyRouter(controller: ClinicReportsFamilyController): Router {
  const router = Router();
  const base = "/families/:familyId/members/:memberId/appointments/:appointmentId/report";

  router.get(
    base,
    asyncHandler(async (req, res) => {
      res.json(await controller.getFamilyConsultationReport(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "appointmentId"), buildRequestContext(req)));
    }),
  );

  router.get(
    `${base}/pdf`,
    asyncHandler(async (req, res) => {
      const pdf = await controller.getFamilyConsultationReportPdf(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "appointmentId"), buildRequestContext(req));
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Disposition", `attachment; filename="${pdf.filename}"`);
      res.send(pdf.bytes);
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/exam-orders",
    asyncHandler(async (req, res) => {
      const status = typeof req.query.status === "string" && ORDER_STATUSES.has(req.query.status) ? (req.query.status as ListFamilyExamOrdersQuery["status"]) : undefined;
      const appointmentId = typeof req.query.appointmentId === "string" ? req.query.appointmentId : undefined;
      const items = await controller.listFamilyExamOrders(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), {
        ...(status ? { status } : {}),
        ...(appointmentId ? { appointmentId } : {}),
      });
      res.json({ items });
    }),
  );

  return router;
}
