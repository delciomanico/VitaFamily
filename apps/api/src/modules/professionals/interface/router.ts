// Controllers HTTP de `/professional-portal/auth/*` (tag «Professional Portal», BR-MKT-13/14). Rotas de perfil, credenciais, ofertas e
// horários acrescentam-se nas fatias seguintes.
import { Router } from "express";
import { getProfessionalActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, type RequestContext } from "../../../platform/http/index.js";
import type { RefreshInput } from "../application/refresh.js";
import type { ProfessionalLoginResult } from "../application/session-result.js";
import { PROFESSIONAL_REFRESH_TOKEN_COOKIE, parseCookieHeader } from "../domain/cookie.js";
import { clearProfessionalRefreshCookie, setProfessionalRefreshCookie } from "./cookies.js";

export interface ProfessionalAuthController {
  register: (input: { email: string; password: string; termsVersion: string }, ctx: RequestContext) => Promise<void>;
  verifyEmail: (email: string, code: string, ctx: RequestContext) => Promise<void>;
  resendVerification: (email: string, ctx: RequestContext) => Promise<void>;
  login: (input: { email: string; password: string }, ctx: RequestContext) => Promise<ProfessionalLoginResult>;
  refresh: (input: RefreshInput, ctx: RequestContext) => Promise<ProfessionalLoginResult>;
  logout: (accountId: string, sessionId: string, ctx: RequestContext) => Promise<void>;
  forgotPassword: (email: string, ctx: RequestContext) => Promise<void>;
  resetPassword: (email: string, code: string, newPassword: string, ctx: RequestContext) => Promise<void>;
}

/** Resposta neutra (a mesma exista ou não a conta, BR-MKT-14). */
const NEUTRAL_MESSAGE = { message: "Se o e-mail for válido, enviámos um código." };

function tokenResponse(result: ProfessionalLoginResult) {
  return {
    accessToken: result.accessToken,
    expiresIn: result.expiresIn,
    professionalId: result.professionalId,
    validationStatus: result.validationStatus,
  };
}

export function createProfessionalAuthRouter(controller: ProfessionalAuthController, cookieDomain: string): Router {
  const router = Router();

  router.post(
    "/professional-portal/auth/register",
    asyncHandler(async (req, res) => {
      await controller.register(req.body as { email: string; password: string; termsVersion: string }, buildRequestContext(req));
      res.status(202).json(NEUTRAL_MESSAGE);
    }),
  );

  router.post(
    "/professional-portal/auth/verify-email",
    asyncHandler(async (req, res) => {
      const body = req.body as { email: string; token: string };
      await controller.verifyEmail(body.email, body.token, buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.post(
    "/professional-portal/auth/resend-verification",
    asyncHandler(async (req, res) => {
      await controller.resendVerification((req.body as { email: string }).email, buildRequestContext(req));
      res.status(202).json(NEUTRAL_MESSAGE);
    }),
  );

  router.post(
    "/professional-portal/auth/login",
    asyncHandler(async (req, res) => {
      const result = await controller.login(req.body as { email: string; password: string }, buildRequestContext(req));
      setProfessionalRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, cookieDomain);
      res.set("Cache-Control", "no-store").json(tokenResponse(result));
    }),
  );

  router.post(
    "/professional-portal/auth/refresh",
    asyncHandler(async (req, res) => {
      const refreshToken = parseCookieHeader(req.headers.cookie)[PROFESSIONAL_REFRESH_TOKEN_COOKIE];
      if (!refreshToken) {
        throw new UnauthenticatedError({ detail: "Sem sessão válida." });
      }
      const input: RefreshInput = { refreshToken };
      const xRequestedWith = req.header("X-Requested-With");
      if (xRequestedWith !== undefined) input.xRequestedWith = xRequestedWith;
      const result = await controller.refresh(input, buildRequestContext(req));
      setProfessionalRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, cookieDomain);
      res.set("Cache-Control", "no-store").json(tokenResponse(result));
    }),
  );

  router.post(
    "/professional-portal/auth/logout",
    asyncHandler(async (req, res) => {
      const actor = getProfessionalActor();
      if (!actor) {
        throw new UnauthenticatedError({ detail: "Sem sessão válida." });
      }
      await controller.logout(actor.professionalAccountId, actor.sessionId, buildRequestContext(req));
      clearProfessionalRefreshCookie(res, cookieDomain);
      res.status(204).end();
    }),
  );

  router.post(
    "/professional-portal/auth/password/forgot",
    asyncHandler(async (req, res) => {
      await controller.forgotPassword((req.body as { email: string }).email, buildRequestContext(req));
      res.status(202).json(NEUTRAL_MESSAGE);
    }),
  );

  router.post(
    "/professional-portal/auth/password/reset",
    asyncHandler(async (req, res) => {
      const body = req.body as { email: string; token: string; newPassword: string };
      await controller.resetPassword(body.email, body.token, body.newPassword, buildRequestContext(req));
      res.status(204).end();
    }),
  );

  return router;
}
