// Controllers HTTP de `/auth/*` (openapi.yaml operationIds: register, verifyEmail,
// resendVerification, login, refreshToken, logout, forgotPassword, resetPassword,
// changePassword).
import { Router } from "express";
import { asyncHandler, buildRequestContext, type RequestContext } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { RegisterInput } from "../application/register.js";
import type { LoginInput, LoginResult } from "../application/login.js";
import type { RefreshInput } from "../application/refresh.js";
import { parseCookieHeader, REFRESH_TOKEN_COOKIE } from "../domain/cookie.js";
import { clearRefreshCookie, setRefreshCookie } from "./cookies.js";

export interface AuthController {
  register: (input: RegisterInput, ctx: RequestContext) => Promise<void>;
  verifyEmail: (token: string, ctx: RequestContext) => Promise<void>;
  resendVerification: (email: string, ctx: RequestContext) => Promise<void>;
  login: (input: LoginInput, ctx: RequestContext) => Promise<LoginResult>;
  refresh: (input: RefreshInput, ctx: RequestContext) => Promise<LoginResult>;
  logout: (userId: string, sessionId: string, ctx: RequestContext) => Promise<void>;
  forgotPassword: (email: string, ctx: RequestContext) => Promise<void>;
  resetPassword: (token: string, newPassword: string, ctx: RequestContext) => Promise<void>;
  changePassword: (
    userId: string,
    sessionId: string,
    input: { currentPassword: string; newPassword: string },
    ctx: RequestContext,
  ) => Promise<void>;
}

function requireActor(): { userId: string; sessionId: string } {
  const actor = getActor();
  if (!actor?.sessionId) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, sessionId: actor.sessionId };
}

export function createAuthRouter(controller: AuthController, cookieDomain: string): Router {
  const router = Router();

  router.post(
    "/auth/register",
    asyncHandler(async (req, res) => {
      const body = req.body as RegisterInput;
      await controller.register(body, buildRequestContext(req));
      res.status(202).json({ message: "Se os dados forem válidos, receberá um e-mail de verificação." });
    }),
  );

  router.post(
    "/auth/verify-email",
    asyncHandler(async (req, res) => {
      const body = req.body as { token: string };
      await controller.verifyEmail(body.token, buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.post(
    "/auth/resend-verification",
    asyncHandler(async (req, res) => {
      const body = req.body as { email: string };
      await controller.resendVerification(body.email, buildRequestContext(req));
      res.status(202).json({ message: "Se a conta existir e estiver por verificar, enviámos um novo e-mail." });
    }),
  );

  router.post(
    "/auth/login",
    asyncHandler(async (req, res) => {
      const body = req.body as LoginInput;
      const result = await controller.login(body, buildRequestContext(req));
      setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, cookieDomain);
      res.json({ accessToken: result.accessToken, expiresIn: result.expiresIn });
    }),
  );

  router.post(
    "/auth/refresh",
    asyncHandler(async (req, res) => {
      const cookies = parseCookieHeader(req.headers.cookie);
      const refreshToken = cookies[REFRESH_TOKEN_COOKIE];
      if (!refreshToken) {
        throw new UnauthenticatedError({ detail: "Sem sessão válida." });
      }
      const xRequestedWith = req.header("X-Requested-With");
      const input: RefreshInput = { refreshToken };
      if (xRequestedWith !== undefined) {
        input.xRequestedWith = xRequestedWith;
      }
      const result = await controller.refresh(input, buildRequestContext(req));
      setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, cookieDomain);
      res.json({ accessToken: result.accessToken, expiresIn: result.expiresIn });
    }),
  );

  router.post(
    "/auth/logout",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      await controller.logout(actor.userId, actor.sessionId, buildRequestContext(req));
      clearRefreshCookie(res, cookieDomain);
      res.status(204).end();
    }),
  );

  router.post(
    "/auth/password/forgot",
    asyncHandler(async (req, res) => {
      const body = req.body as { email: string };
      await controller.forgotPassword(body.email, buildRequestContext(req));
      res.status(202).json({ message: "Se a conta existir, enviámos instruções de recuperação." });
    }),
  );

  router.post(
    "/auth/password/reset",
    asyncHandler(async (req, res) => {
      const body = req.body as { token: string; newPassword: string };
      await controller.resetPassword(body.token, body.newPassword, buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.post(
    "/auth/password/change",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const body = req.body as { currentPassword: string; newPassword: string };
      await controller.changePassword(actor.userId, actor.sessionId, body, buildRequestContext(req));
      res.status(204).end();
    }),
  );

  return router;
}
