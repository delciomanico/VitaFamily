// Controllers HTTP de `/insurance-portal/authorizations*` e `/insurance-portal/auto-approval-rules*` (marco B fatia 4; openapi tag
// "Insurance Portal", ADR-035, authorization.md §8.2b/§8.2d). O ator vem SEMPRE da sessão (`getInsuranceActor`), nunca do corpo/query/
// caminho. `metrics` e `assignees` registam-se ANTES de `/{authorizationId}`. Dados de terceiros: nunca em cache.
import { Router } from "express";
import { getInsuranceActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { Page } from "../../../platform/page/index.js";
import type { OpsActor } from "../domain/access.js";
import type { AttachmentDownload } from "../application/download-authorization-attachment.js";
import type { AuthorizationMetricsView } from "../application/authorization-metrics.js";
import type { AutoApprovalRuleView } from "../application/auto-approval-rules.js";
import type { InsurerAuthorizationDetailView, InsurerAuthorizationView } from "../application/insurer-authorization-support.js";
import type { ListInsurerAuthorizationsQuery } from "../application/list-insurer-authorizations.js";
import type { AuthorizationAssignee } from "../application/ports.js";
import type { RequestContext } from "./types.js";
import {
  toAuthorizationAssigneeResponse,
  toAuthorizationMetricsResponse,
  toAutoApprovalRuleResponse,
  toInsurerAuthorizationDetailResponse,
  toInsurerAuthorizationPageResponse,
} from "./dto.js";

type Action = (actor: OpsActor, authorizationId: string, body: unknown, ctx: RequestContext) => Promise<InsurerAuthorizationDetailView>;

export interface InsurerAuthorizationsController {
  listAuthorizations: (actor: OpsActor, query: ListInsurerAuthorizationsQuery) => Promise<Page<InsurerAuthorizationView>>;
  getMetrics: (actor: OpsActor, query: { from?: unknown; to?: unknown }) => Promise<AuthorizationMetricsView>;
  listAssignees: (actor: OpsActor) => Promise<AuthorizationAssignee[]>;
  getAuthorization: (actor: OpsActor, authorizationId: string) => Promise<InsurerAuthorizationDetailView>;
  assign: Action;
  requestInfo: Action;
  approve: Action;
  reject: Action;
  cancel: Action;
  reopen: Action;
  downloadAttachment: (actor: OpsActor, authorizationId: string, attachmentId: string, ctx: RequestContext) => Promise<AttachmentDownload>;
  listRules: (actor: OpsActor) => Promise<AutoApprovalRuleView[]>;
  createRule: (actor: OpsActor, body: unknown, ctx: RequestContext) => Promise<AutoApprovalRuleView>;
  updateRule: (actor: OpsActor, ruleId: string, body: unknown, ctx: RequestContext) => Promise<AutoApprovalRuleView>;
  deleteRule: (actor: OpsActor, ruleId: string, ctx: RequestContext) => Promise<void>;
}

function requireActor(): OpsActor {
  const actor = getInsuranceActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { insuranceAccountId: actor.insuranceAccountId, insurerId: actor.insurerId, role: actor.role };
}

/** `Content-Disposition: attachment` com nome seguro (ASCII, aspas escapadas) e `filename*` (RFC 5987): o nome vem da clínica. */
function contentDisposition(originalName: string): string {
  const ascii = originalName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(originalName)}`;
}

export function createInsurerAuthorizationsRouter(c: InsurerAuthorizationsController): Router {
  const router = Router();
  const base = "/insurance-portal/authorizations";
  const rules = "/insurance-portal/auto-approval-rules";
  for (const prefix of [base, rules]) {
    router.use(prefix, (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    });
  }

  router.get(base, asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    res.json(toInsurerAuthorizationPageResponse(await c.listAuthorizations(requireActor(), { status: q.status, assigned: q.assigned, overdue: q.overdue, escalated: q.escalated, appeal: q.appeal, decidedBy: q.decidedBy, sort: q.sort, limit: q.limit, cursor: q.cursor })));
  }));
  router.get(`${base}/metrics`, asyncHandler(async (req, res) => {
    const q = req.query as Record<string, unknown>;
    res.json(toAuthorizationMetricsResponse(await c.getMetrics(requireActor(), { from: q.from, to: q.to })));
  }));
  router.get(`${base}/assignees`, asyncHandler(async (_req, res) => {
    res.json((await c.listAssignees(requireActor())).map(toAuthorizationAssigneeResponse));
  }));
  router.get(`${base}/:authorizationId`, asyncHandler(async (req, res) => {
    res.json(toInsurerAuthorizationDetailResponse(await c.getAuthorization(requireActor(), requireParam(req, "authorizationId"))));
  }));

  const action = (path: string, run: Action) =>
    router.post(`${base}/:authorizationId/${path}`, asyncHandler(async (req, res) => {
      res.json(toInsurerAuthorizationDetailResponse(await run(requireActor(), requireParam(req, "authorizationId"), req.body, buildRequestContext(req))));
    }));
  action("assign", c.assign);
  action("request-info", c.requestInfo);
  action("approve", c.approve);
  action("reject", c.reject);
  action("cancel", c.cancel);
  action("reopen", c.reopen);

  router.get(`${base}/:authorizationId/attachments/:attachmentId`, asyncHandler(async (req, res) => {
    const file = await c.downloadAttachment(requireActor(), requireParam(req, "authorizationId"), requireParam(req, "attachmentId"), buildRequestContext(req));
    // ADR-006: nunca cacheável, entrega mediada (nunca URL pública).
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Content-Disposition", contentDisposition(file.originalName));
    file.stream.on("error", () => { res.destroy(); });
    file.stream.pipe(res);
  }));

  router.get(rules, asyncHandler(async (_req, res) => {
    res.json((await c.listRules(requireActor())).map(toAutoApprovalRuleResponse));
  }));
  router.post(rules, asyncHandler(async (req, res) => {
    res.status(201).json(toAutoApprovalRuleResponse(await c.createRule(requireActor(), req.body, buildRequestContext(req))));
  }));
  router.patch(`${rules}/:ruleId`, asyncHandler(async (req, res) => {
    res.json(toAutoApprovalRuleResponse(await c.updateRule(requireActor(), requireParam(req, "ruleId"), req.body, buildRequestContext(req))));
  }));
  router.delete(`${rules}/:ruleId`, asyncHandler(async (req, res) => {
    await c.deleteRule(requireActor(), requireParam(req, "ruleId"), buildRequestContext(req));
    res.status(204).end();
  }));

  return router;
}
