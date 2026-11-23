// Controllers HTTP de `reports` (openapi.yaml operationIds: memberReport, familyReport — tag
// "Reports"). Só JSON (D10-A); sem PDF nem partilha por link.
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { ActorIdentity, RequestContext } from "../application/ports.js";
import type { MemberReportQuery } from "../application/member-report.js";
import type { HealthSummaryQuery } from "../application/health-summary.js";

export interface ReportsController {
  memberReport: (actor: ActorIdentity, familyId: string, memberId: string, query: MemberReportQuery, context: RequestContext) => Promise<unknown>;
  familyReport: (actor: ActorIdentity, familyId: string, context: RequestContext) => Promise<unknown>;
  /** M17 (UC-RPT-05/05b): `getMemberHealthSummary` e `getFamilyHealthSummary`. */
  memberHealthSummary: (actor: ActorIdentity, familyId: string, memberId: string, query: HealthSummaryQuery, context: RequestContext) => Promise<unknown>;
  familyHealthSummary: (actor: ActorIdentity, familyId: string, query: HealthSummaryQuery, context: RequestContext) => Promise<unknown>;
}

const periodQuery = (req: { query: Record<string, unknown> }): HealthSummaryQuery => {
  const from = queryString(req, "from");
  const to = queryString(req, "to");
  return { ...(from ? { from } : {}), ...(to ? { to } : {}) };
};

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

function queryString(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

export function createReportsRouter(controller: ReportsController): Router {
  const router = Router();

  router.get(
    "/families/:familyId/members/:memberId/report",
    asyncHandler(async (req, res) => {
      const from = queryString(req, "from");
      const to = queryString(req, "to");
      const query: MemberReportQuery = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
      const result = await controller.memberReport(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), query, buildRequestContext(req));
      res.json(result);
    }),
  );

  router.get(
    "/families/:familyId/report",
    asyncHandler(async (req, res) => {
      const result = await controller.familyReport(requireActor(), requireParam(req, "familyId"), buildRequestContext(req));
      res.json(result);
    }),
  );

  // M17: o Resumo nunca é guardado nem partilhado por ligação (BR-RPT-18); resposta sempre privada.
  router.get(
    "/families/:familyId/members/:memberId/health-summary",
    asyncHandler(async (req, res) => {
      const result = await controller.memberHealthSummary(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), periodQuery(req), buildRequestContext(req));
      res.setHeader("Cache-Control", "private, no-store");
      res.json(result);
    }),
  );

  router.get(
    "/families/:familyId/health-summary",
    asyncHandler(async (req, res) => {
      const result = await controller.familyHealthSummary(requireActor(), requireParam(req, "familyId"), periodQuery(req), buildRequestContext(req));
      res.setHeader("Cache-Control", "private, no-store");
      res.json(result);
    }),
  );

  return router;
}
