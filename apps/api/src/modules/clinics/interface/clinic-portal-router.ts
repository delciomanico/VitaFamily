// Controllers HTTP de `/clinic-portal/*` (openapi.yaml operationIds: clinicLogin,
// clinicRefreshToken, clinicLogout, listClinicStaff, createClinicStaff, removeClinicStaff,
// listOwnClinicSlots, publishClinicSlots, removeClinicSlot — tag "Clinic Portal", ADR-020/Fase C).
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError, ValidationError } from "../../../platform/errors/index.js";
import type { CreateClinicStaffInput } from "../application/manage-clinic-staff.js";
import type { ClinicLoginInput, ClinicLoginResult } from "../application/clinic-login.js";
import type { ClinicRefreshInput } from "../application/clinic-refresh.js";
import type { ClinicSlotListQuery, PublishClinicSlotsInput } from "../application/clinic-slots.js";
import type { ClinicAccount, ClinicPortalActor, ClinicSlot } from "../application/ports.js";
import { CLINIC_REFRESH_TOKEN_COOKIE, parseClinicCookieHeader } from "../domain/clinic-cookie.js";
import { clearClinicRefreshCookie, setClinicRefreshCookie } from "./clinic-portal-cookies.js";
import { toClinicAccountListResponse, toClinicAccountResponse, toClinicSlotListResponse, toClinicSlotViewListResponse } from "./dto.js";

export interface ClinicPortalController {
  clinicLogin: (input: ClinicLoginInput, ctx: RequestContext) => Promise<ClinicLoginResult>;
  clinicRefresh: (input: ClinicRefreshInput, ctx: RequestContext) => Promise<ClinicLoginResult>;
  clinicLogout: (clinicAccountId: string, sessionId: string, ctx: RequestContext) => Promise<void>;
  // Hierarquia de staff (Fase C, BR-CLN-05):
  listClinicStaff: (actor: ClinicPortalActor) => Promise<ClinicAccount[]>;
  createClinicStaff: (actor: ClinicPortalActor, input: CreateClinicStaffInput, ctx: RequestContext) => Promise<ClinicAccount>;
  removeClinicStaff: (actor: ClinicPortalActor, clinicAccountId: string, ctx: RequestContext) => Promise<void>;
  // Horários (Fase C, BR-CLN-04):
  listOwnClinicSlots: (actor: ClinicPortalActor, query: ClinicSlotListQuery) => Promise<ClinicSlot[]>;
  publishClinicSlots: (actor: ClinicPortalActor, input: PublishClinicSlotsInput, ctx: RequestContext) => Promise<ClinicSlot[]>;
  removeClinicSlot: (actor: ClinicPortalActor, slotId: string, ctx: RequestContext) => Promise<void>;
}

function requireClinicActor(): { clinicAccountId: string; sessionId: string } {
  const actor = getClinicActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { clinicAccountId: actor.clinicAccountId, sessionId: actor.sessionId };
}

/** Ator do portal (Fase C): `clinicId`/`role` da sessão — nunca do corpo/query do pedido
 * (authorization.md §6.1: o `clinicId` vem sempre da sessão, não do caminho, para estas rotas). */
function requireClinicPortalActor(): ClinicPortalActor {
  const actor = getClinicActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, role: actor.role };
}

function queryString(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

function parseDateQuery(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ field, message: "data/hora inválida" }], { detail: "Filtro de período inválido." });
  }
  return date;
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

  // --- Hierarquia de staff (Fase C, BR-CLN-05) ---

  router.get(
    "/clinic-portal/staff",
    asyncHandler(async (_req, res) => {
      const result = await controller.listClinicStaff(requireClinicPortalActor());
      res.json(toClinicAccountListResponse(result));
    }),
  );

  router.post(
    "/clinic-portal/staff",
    asyncHandler(async (req, res) => {
      const result = await controller.createClinicStaff(requireClinicPortalActor(), req.body as CreateClinicStaffInput, buildRequestContext(req));
      res.status(201).json(toClinicAccountResponse(result));
    }),
  );

  router.delete(
    "/clinic-portal/staff/:clinicAccountId",
    asyncHandler(async (req, res) => {
      await controller.removeClinicStaff(requireClinicPortalActor(), requireParam(req, "clinicAccountId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  // --- Horários (Fase C, BR-CLN-04) ---

  router.get(
    "/clinic-portal/slots",
    asyncHandler(async (req, res) => {
      const query: ClinicSlotListQuery = {};
      const from = parseDateQuery(queryString(req, "from"), "from");
      const to = parseDateQuery(queryString(req, "to"), "to");
      if (from) query.from = from;
      if (to) query.to = to;
      const result = await controller.listOwnClinicSlots(requireClinicPortalActor(), query);
      res.json(toClinicSlotViewListResponse(result));
    }),
  );

  router.post(
    "/clinic-portal/slots",
    asyncHandler(async (req, res) => {
      const result = await controller.publishClinicSlots(requireClinicPortalActor(), req.body as PublishClinicSlotsInput, buildRequestContext(req));
      res.status(201).json(toClinicSlotListResponse(result));
    }),
  );

  router.delete(
    "/clinic-portal/slots/:slotId",
    asyncHandler(async (req, res) => {
      await controller.removeClinicSlot(requireClinicPortalActor(), requireParam(req, "slotId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  return router;
}
