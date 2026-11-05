// Controllers HTTP de `/insurance-portal/*` desta fase (openapi operationIds: insuranceLogin,
// insuranceRefreshToken, insuranceLogout, listInsuranceAgents, createInsuranceAgent,
// removeInsuranceAgent, listInsuranceClaims, getInsuranceClaim, decideInsuranceClaim — tag
// "Insurance Portal", ADR-021).
import { Router } from "express";
import { getInsuranceActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import type { InsuranceLoginInput, InsuranceLoginResult } from "../application/insurance-login.js";
import type { DecideInsuranceClaimInput, InsuranceClaimView } from "../application/portal-claims.js";
import type { InsuranceRefreshInput } from "../application/insurance-refresh.js";
import type { CreateInsuranceAgentInput } from "../application/manage-insurance-agents.js";
import type { InsuranceAccount, InsurancePortalActor } from "../application/ports.js";
import { INSURANCE_REFRESH_TOKEN_COOKIE, parseInsuranceCookieHeader } from "../domain/insurance-cookie.js";
import { toInsuranceAccountResponse, toInsuranceClaimViewResponse } from "./dto.js";
import { clearInsuranceRefreshCookie, setInsuranceRefreshCookie } from "./insurance-portal-cookies.js";

export interface InsurancePortalController {
  insuranceLogin: (input: InsuranceLoginInput, ctx: RequestContext) => Promise<InsuranceLoginResult>;
  insuranceRefresh: (input: InsuranceRefreshInput, ctx: RequestContext) => Promise<InsuranceLoginResult>;
  insuranceLogout: (insuranceAccountId: string, sessionId: string, ctx: RequestContext) => Promise<void>;
  listInsuranceAgents: (actor: InsurancePortalActor) => Promise<InsuranceAccount[]>;
  createInsuranceAgent: (actor: InsurancePortalActor, input: CreateInsuranceAgentInput, ctx: RequestContext) => Promise<InsuranceAccount>;
  removeInsuranceAgent: (actor: InsurancePortalActor, insuranceAccountId: string, ctx: RequestContext) => Promise<void>;
  listInsuranceClaims: (actor: InsurancePortalActor, query: { status?: string }) => Promise<InsuranceClaimView[]>;
  getInsuranceClaim: (actor: InsurancePortalActor, claimId: string) => Promise<InsuranceClaimView>;
  decideInsuranceClaim: (actor: InsurancePortalActor, claimId: string, input: DecideInsuranceClaimInput, ctx: RequestContext) => Promise<InsuranceClaimView>;
}

/** `insurerId`/`role` vêm sempre da sessão, nunca do corpo/query/caminho (authorization.md §8.1). */
function requireInsuranceActor() {
  const actor = getInsuranceActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return actor;
}

function tokenBody(result: InsuranceLoginResult) {
  return { accessToken: result.accessToken, expiresIn: result.expiresIn, insurerId: result.insurerId, role: result.role };
}

export function createInsurancePortalRouter(controller: InsurancePortalController, cookieDomain: string): Router {
  const router = Router();

  router.post(
    "/insurance-portal/auth/login",
    asyncHandler(async (req, res) => {
      const result = await controller.insuranceLogin(req.body as InsuranceLoginInput, buildRequestContext(req));
      setInsuranceRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, cookieDomain);
      res.json(tokenBody(result));
    }),
  );

  router.post(
    "/insurance-portal/auth/refresh",
    asyncHandler(async (req, res) => {
      const refreshToken = parseInsuranceCookieHeader(req.headers.cookie)[INSURANCE_REFRESH_TOKEN_COOKIE];
      if (!refreshToken) {
        throw new UnauthenticatedError({ detail: "Sem sessão válida." });
      }
      const result = await controller.insuranceRefresh({ refreshToken }, buildRequestContext(req));
      setInsuranceRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, cookieDomain);
      res.json(tokenBody(result));
    }),
  );

  router.post(
    "/insurance-portal/auth/logout",
    asyncHandler(async (req, res) => {
      const actor = requireInsuranceActor();
      await controller.insuranceLogout(actor.insuranceAccountId, actor.sessionId, buildRequestContext(req));
      clearInsuranceRefreshCookie(res, cookieDomain);
      res.status(204).end();
    }),
  );

  router.get(
    "/insurance-portal/agents",
    asyncHandler(async (_req, res) => {
      res.json((await controller.listInsuranceAgents(requireInsuranceActor())).map(toInsuranceAccountResponse));
    }),
  );

  router.post(
    "/insurance-portal/agents",
    asyncHandler(async (req, res) => {
      const result = await controller.createInsuranceAgent(requireInsuranceActor(), req.body as CreateInsuranceAgentInput, buildRequestContext(req));
      res.status(201).json(toInsuranceAccountResponse(result));
    }),
  );

  router.delete(
    "/insurance-portal/agents/:insuranceAccountId",
    asyncHandler(async (req, res) => {
      await controller.removeInsuranceAgent(requireInsuranceActor(), requireParam(req, "insuranceAccountId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.get(
    "/insurance-portal/claims",
    asyncHandler(async (req, res) => {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.json((await controller.listInsuranceClaims(requireInsuranceActor(), status === undefined ? {} : { status })).map(toInsuranceClaimViewResponse));
    }),
  );

  router.get(
    "/insurance-portal/claims/:claimId",
    asyncHandler(async (req, res) => {
      res.json(toInsuranceClaimViewResponse(await controller.getInsuranceClaim(requireInsuranceActor(), requireParam(req, "claimId"))));
    }),
  );

  router.put(
    "/insurance-portal/claims/:claimId/decide",
    asyncHandler(async (req, res) => {
      const result = await controller.decideInsuranceClaim(requireInsuranceActor(), requireParam(req, "claimId"), req.body as DecideInsuranceClaimInput, buildRequestContext(req));
      res.json(toInsuranceClaimViewResponse(result));
    }),
  );

  return router;
}
