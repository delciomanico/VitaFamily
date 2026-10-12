// Controllers HTTP de `/clinic-portal/auth/*` (openapi.yaml operationIds: clinicLogin,
// clinicRefreshToken, clinicLogout — tag "Clinic Portal", ADR-020).
import { Router } from "express";
import { asyncHandler, buildRequestContext, type RequestContext } from "../../../platform/http/index.js";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { ClinicLoginInput, ClinicLoginResult } from "../application/clinic-login.js";
import type { ClinicRefreshInput } from "../application/clinic-refresh.js";
import { CLINIC_REFRESH_TOKEN_COOKIE, parseClinicCookieHeader } from "../domain/clinic-cookie.js";
import { clearClinicRefreshCookie, setClinicRefreshCookie } from "./clinic-portal-cookies.js";

export interface ClinicPortalController {
  clinicLogin: (input: ClinicLoginInput, ctx: RequestContext) => Promise<ClinicLoginResult>;
  clinicRefresh: (input: ClinicRefreshInput, ctx: RequestContext) => Promise<ClinicLoginResult>;
  clinicLogout: (clinicAccountId: string, sessionId: string, ctx: RequestContext) => Promise<void>;
}

function requireClinicActor(): { clinicAccountId: string; sessionId: string } {
  const actor = getClinicActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { clinicAccountId: actor.clinicAccountId, sessionId: actor.sessionId };
}

export function createClinicPortalRouter(controller: ClinicPortalController, cookieDomain: string): Router {
  const router = Router();

  router.post(
    "/clinic-portal/auth/login",
    asyncHandler(async (req, res) => {
      const body = req.body as ClinicLoginInput;
      const result = await controller.clinicLogin(body, buildRequestContext(req));
      setClinicRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, cookieDomain);
      res.json({
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        clinicId: result.clinicId,
        role: result.role,
      });
    }),
  );

  router.post(
    "/clinic-portal/auth/refresh",
    asyncHandler(async (req, res) => {
      const cookies = parseClinicCookieHeader(req.headers.cookie);
      const refreshToken = cookies[CLINIC_REFRESH_TOKEN_COOKIE];
      if (!refreshToken) {
        throw new UnauthenticatedError({ detail: "Sem sessão válida." });
      }
      const result = await controller.clinicRefresh({ refreshToken }, buildRequestContext(req));
      setClinicRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, cookieDomain);
      res.json({
        accessToken: result.accessToken,
        expiresIn: result.expiresIn,
        clinicId: result.clinicId,
        role: result.role,
      });
    }),
  );

  router.post(
    "/clinic-portal/auth/logout",
    asyncHandler(async (req, res) => {
      const actor = requireClinicActor();
      await controller.clinicLogout(actor.clinicAccountId, actor.sessionId, buildRequestContext(req));
      clearClinicRefreshCookie(res, cookieDomain);
      res.status(204).end();
    }),
  );

  return router;
}
