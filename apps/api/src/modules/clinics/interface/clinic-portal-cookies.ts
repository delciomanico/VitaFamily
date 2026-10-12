// Cookie `clinic_refresh_token` (endpoints.md: "independente do cookie refresh_token de User",
// ADR-020). HttpOnly; Secure; SameSite=Strict; Path=/api/v1/clinic-portal/auth.
import type { Response } from "express";
import { API_BASE_PATH } from "../../../platform/http/index.js";
import { CLINIC_REFRESH_TOKEN_COOKIE } from "../domain/clinic-cookie.js";

const CLINIC_REFRESH_COOKIE_PATH = `${API_BASE_PATH}/clinic-portal/auth`;

export function setClinicRefreshCookie(res: Response, token: string, expiresAt: Date, cookieDomain: string): void {
  res.cookie(CLINIC_REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: CLINIC_REFRESH_COOKIE_PATH,
    expires: expiresAt,
    ...(cookieDomain.length > 0 ? { domain: cookieDomain } : {}),
  });
}

export function clearClinicRefreshCookie(res: Response, cookieDomain: string): void {
  res.clearCookie(CLINIC_REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: CLINIC_REFRESH_COOKIE_PATH,
    ...(cookieDomain.length > 0 ? { domain: cookieDomain } : {}),
  });
}
