// Cookie `professional_refresh_token` (BR-MKT-13): HttpOnly; Secure; SameSite=Strict; Path=/api/v1/professional-portal/auth.
import type { Response } from "express";
import { API_BASE_PATH } from "../../../platform/http/index.js";
import { PROFESSIONAL_REFRESH_TOKEN_COOKIE } from "../domain/cookie.js";

const PROFESSIONAL_REFRESH_COOKIE_PATH = `${API_BASE_PATH}/professional-portal/auth`;

function isSecureRequest(res: Response): boolean {
  return res.req.secure || res.req.headers["x-forwarded-proto"] === "https";
}

export function setProfessionalRefreshCookie(res: Response, token: string, expiresAt: Date, cookieDomain: string): void {
  res.cookie(PROFESSIONAL_REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: isSecureRequest(res),
    sameSite: "strict",
    path: PROFESSIONAL_REFRESH_COOKIE_PATH,
    expires: expiresAt,
    ...(cookieDomain.length > 0 ? { domain: cookieDomain } : {}),
  });
}

export function clearProfessionalRefreshCookie(res: Response, cookieDomain: string): void {
  res.clearCookie(PROFESSIONAL_REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: isSecureRequest(res),
    sameSite: "strict",
    path: PROFESSIONAL_REFRESH_COOKIE_PATH,
    ...(cookieDomain.length > 0 ? { domain: cookieDomain } : {}),
  });
}
