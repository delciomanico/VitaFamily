// Cookie `refresh_token` (authentication.md §1): HttpOnly; Secure; SameSite=Strict;
// Path=/api/v1/auth.
import type { Response } from "express";
import { API_BASE_PATH } from "../../../platform/http/index.js";
import { REFRESH_TOKEN_COOKIE } from "../domain/cookie.js";

const REFRESH_COOKIE_PATH = `${API_BASE_PATH}/auth`;

function isSecureRequest(res: Response): boolean {
  return res.req.secure || res.req.headers["x-forwarded-proto"] === "https";
}

export function setRefreshCookie(
  res: Response,
  token: string,
  expiresAt: Date,
  cookieDomain: string,
): void {
  res.cookie(REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: isSecureRequest(res),
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
    ...(cookieDomain.length > 0 ? { domain: cookieDomain } : {}),
  });
}

export function clearRefreshCookie(res: Response, cookieDomain: string): void {
  res.clearCookie(REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: isSecureRequest(res),
    sameSite: "strict",
    path: REFRESH_COOKIE_PATH,
    ...(cookieDomain.length > 0 ? { domain: cookieDomain } : {}),
  });
}
