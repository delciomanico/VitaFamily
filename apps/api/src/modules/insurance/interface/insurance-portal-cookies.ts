// Cookie `insurance_refresh_token` (openapi insuranceLogin): HttpOnly; Secure; SameSite=Strict;
// Path=/api/v1/insurance-portal/auth; independente dos cookies de User/ClinicAccount (ADR-021).
import type { Response } from "express";
import { API_BASE_PATH } from "../../../platform/http/index.js";
import { INSURANCE_REFRESH_TOKEN_COOKIE } from "../domain/insurance-cookie.js";

const INSURANCE_REFRESH_COOKIE_PATH = `${API_BASE_PATH}/insurance-portal/auth`;

function isSecureRequest(res: Response): boolean {
  return res.req.secure || res.req.headers["x-forwarded-proto"] === "https";
}

export function setInsuranceRefreshCookie(res: Response, token: string, expiresAt: Date, cookieDomain: string): void {
  res.cookie(INSURANCE_REFRESH_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: isSecureRequest(res),
    sameSite: "strict",
    path: INSURANCE_REFRESH_COOKIE_PATH,
    expires: expiresAt,
    ...(cookieDomain.length > 0 ? { domain: cookieDomain } : {}),
  });
}

export function clearInsuranceRefreshCookie(res: Response, cookieDomain: string): void {
  res.clearCookie(INSURANCE_REFRESH_TOKEN_COOKIE, {
    httpOnly: true,
    secure: isSecureRequest(res),
    sameSite: "strict",
    path: INSURANCE_REFRESH_COOKIE_PATH,
    ...(cookieDomain.length > 0 ? { domain: cookieDomain } : {}),
  });
}
