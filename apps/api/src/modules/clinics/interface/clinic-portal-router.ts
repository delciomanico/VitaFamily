// Controllers HTTP de `/clinic-portal/*` (openapi.yaml operationIds: clinicLogin,
// clinicRefreshToken, clinicLogout, listClinicStaff, createClinicStaff, removeClinicStaff,
// listOwnClinicSlots, publishClinicSlots, updateClinicSlot, removeClinicSlot — tag "Clinic Portal", ADR-020/Fase C).
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError, ValidationError } from "../../../platform/errors/index.js";
import type { ClinicServiceTypeView, CreateClinicProfessionalInput, CreateClinicServiceTypeInput, UpdateClinicProfessionalInput, UpdateClinicServiceTypeInput } from "../application/clinic-catalog.js";
import type { ClinicScheduleRuleResult, CreateClinicScheduleRuleInput, UpdateClinicScheduleRuleInput } from "../application/clinic-schedule-rules.js";
import type { ClinicTimeOffResult, ClinicTimeOffView, CreateClinicTimeOffInput } from "../application/clinic-time-off.js";
import type { ScheduleGeneration } from "../domain/clinic-schedule.js";
import type { CreateClinicStaffInput } from "../application/manage-clinic-staff.js";
import type { ClinicProfile } from "../application/clinic-profile.js";
import type { ClinicLoginInput, ClinicLoginResult } from "../application/clinic-login.js";
import type { ClinicRefreshInput } from "../application/clinic-refresh.js";
import type { ClinicSlotListQuery, ClinicSlotView, PublishClinicSlotsInput, UpdateClinicSlotInput } from "../application/clinic-slots.js";
import type { ClinicAccount, ClinicPortalActor, ClinicProfessional, ClinicScheduleRule, ClinicSlot } from "../application/ports.js";
import { assertValidSlotKind } from "../domain/clinic-slot.js";
import { CLINIC_REFRESH_TOKEN_COOKIE, parseClinicCookieHeader } from "../domain/clinic-cookie.js";
import { clearClinicRefreshCookie, setClinicRefreshCookie } from "./clinic-portal-cookies.js";
import {
  toClinicAccountListResponse,
  toClinicAccountResponse,
  toClinicProfessionalResponse,
  toClinicScheduleRuleResponse,
  toClinicScheduleRuleResultResponse,
  toClinicServiceTypeResponse,
  toClinicSlotListResponse,
  toClinicSlotViewListResponse,
  toClinicSlotViewResponse,
  toClinicTimeOffResponse,
  toClinicTimeOffResultResponse,
  toScheduleGenerationResponse,
} from "./dto.js";

export interface ClinicPortalController {
  clinicLogin: (input: ClinicLoginInput, ctx: RequestContext) => Promise<ClinicLoginResult>;
  clinicRefresh: (input: ClinicRefreshInput, ctx: RequestContext) => Promise<ClinicLoginResult>;
  clinicLogout: (clinicAccountId: string, sessionId: string, ctx: RequestContext) => Promise<void>;
  // Hierarquia de staff (Fase C, BR-CLN-05):
  listClinicStaff: (actor: ClinicPortalActor) => Promise<ClinicAccount[]>;
  createClinicStaff: (actor: ClinicPortalActor, input: CreateClinicStaffInput, ctx: RequestContext) => Promise<ClinicAccount>;
  removeClinicStaff: (actor: ClinicPortalActor, clinicAccountId: string, ctx: RequestContext) => Promise<void>;
  // Perfil (M14 R, BR-CLN-38):
  getClinicProfile: (actor: ClinicPortalActor) => Promise<ClinicProfile>;
  updateClinicProfile: (actor: ClinicPortalActor, body: unknown, ctx: RequestContext) => Promise<ClinicProfile>;
  // Horários (Fase C, BR-CLN-04):
  listOwnClinicSlots: (actor: ClinicPortalActor, query: ClinicSlotListQuery) => Promise<ClinicSlotView[]>;
  publishClinicSlots: (actor: ClinicPortalActor, input: PublishClinicSlotsInput, ctx: RequestContext) => Promise<ClinicSlot[]>;
  updateClinicSlot: (actor: ClinicPortalActor, slotId: string, input: UpdateClinicSlotInput, ctx: RequestContext) => Promise<ClinicSlotView>;
  removeClinicSlot: (actor: ClinicPortalActor, slotId: string, ctx: RequestContext) => Promise<void>;
  // Catálogo (M14 a1, BR-CLN-11/12):
  listClinicProfessionals: (actor: ClinicPortalActor, query: { active?: boolean }) => Promise<ClinicProfessional[]>;
  createClinicProfessional: (actor: ClinicPortalActor, input: CreateClinicProfessionalInput, ctx: RequestContext) => Promise<ClinicProfessional>;
  updateClinicProfessional: (actor: ClinicPortalActor, professionalId: string, input: UpdateClinicProfessionalInput, ctx: RequestContext) => Promise<ClinicProfessional>;
  listClinicServiceTypes: (actor: ClinicPortalActor, query: { active?: boolean; kind?: string }) => Promise<ClinicServiceTypeView[]>;
  createClinicServiceType: (actor: ClinicPortalActor, input: CreateClinicServiceTypeInput, ctx: RequestContext) => Promise<ClinicServiceTypeView>;
  updateClinicServiceType: (actor: ClinicPortalActor, serviceTypeId: string, input: UpdateClinicServiceTypeInput, ctx: RequestContext) => Promise<ClinicServiceTypeView>;
  // Regras de horário e bloqueios (M14 a2, BR-CLN-12..15):
  listClinicScheduleRules: (actor: ClinicPortalActor, query: { professionalId?: string; active?: boolean }) => Promise<ClinicScheduleRule[]>;
  createClinicScheduleRule: (actor: ClinicPortalActor, input: CreateClinicScheduleRuleInput, ctx: RequestContext) => Promise<ClinicScheduleRuleResult>;
  updateClinicScheduleRule: (actor: ClinicPortalActor, ruleId: string, input: UpdateClinicScheduleRuleInput, ctx: RequestContext) => Promise<ClinicScheduleRuleResult>;
  regenerateClinicScheduleRule: (actor: ClinicPortalActor, ruleId: string, ctx: RequestContext) => Promise<ClinicScheduleRuleResult>;
  listClinicTimeOff: (actor: ClinicPortalActor, query: { professionalId?: string; from?: Date; to?: Date }) => Promise<ClinicTimeOffView[]>;
  createClinicTimeOff: (actor: ClinicPortalActor, input: CreateClinicTimeOffInput, ctx: RequestContext) => Promise<ClinicTimeOffResult>;
  deleteClinicTimeOff: (actor: ClinicPortalActor, timeOffId: string, ctx: RequestContext) => Promise<ScheduleGeneration>;
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
  return { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, role: actor.role, ...(actor.professionalId ? { professionalId: actor.professionalId } : {}) };
}

function queryString(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

function booleanQuery(req: { query: Record<string, unknown> }, name: string): boolean | undefined {
  const value = req.query[name];
  if (value === undefined) {
    return undefined;
  }
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  throw new ValidationError([{ field: name, message: "true ou false" }], { detail: "Filtro inválido." });
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
        ...(result.professionalId ? { professionalId: result.professionalId } : {}),
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
        ...(result.professionalId ? { professionalId: result.professionalId } : {}),
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

  // --- Perfil da clínica (M14 R, BR-CLN-38) ---

  router.get(
    "/clinic-portal/profile",
    asyncHandler(async (_req, res) => {
      res.json(await controller.getClinicProfile(requireClinicPortalActor()));
    }),
  );

  router.patch(
    "/clinic-portal/profile",
    asyncHandler(async (req, res) => {
      res.json(await controller.updateClinicProfile(requireClinicPortalActor(), req.body, buildRequestContext(req)));
    }),
  );

  // --- Horários (Fase C, BR-CLN-04) ---

  router.get(
    "/clinic-portal/slots",
    asyncHandler(async (req, res) => {
      const query: ClinicSlotListQuery = {};
      const kind = queryString(req, "kind");
      if (kind !== undefined) query.kind = assertValidSlotKind(kind);
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

  router.patch(
    "/clinic-portal/slots/:slotId",
    asyncHandler(async (req, res) => {
      const body = req.body as UpdateClinicSlotInput;
      const result = await controller.updateClinicSlot(requireClinicPortalActor(), requireParam(req, "slotId"), body, buildRequestContext(req));
      res.json(toClinicSlotViewResponse(result));
    }),
  );

  router.delete(
    "/clinic-portal/slots/:slotId",
    asyncHandler(async (req, res) => {
      await controller.removeClinicSlot(requireClinicPortalActor(), requireParam(req, "slotId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  // --- Catálogo (M14 a1, BR-CLN-11/12): sem DELETE, desativa-se ---

  router.get(
    "/clinic-portal/professionals",
    asyncHandler(async (req, res) => {
      const active = booleanQuery(req, "active");
      const result = await controller.listClinicProfessionals(requireClinicPortalActor(), active === undefined ? {} : { active });
      res.json(result.map(toClinicProfessionalResponse));
    }),
  );

  router.post(
    "/clinic-portal/professionals",
    asyncHandler(async (req, res) => {
      const result = await controller.createClinicProfessional(requireClinicPortalActor(), req.body as CreateClinicProfessionalInput, buildRequestContext(req));
      res.status(201).json(toClinicProfessionalResponse(result));
    }),
  );

  router.patch(
    "/clinic-portal/professionals/:professionalId",
    asyncHandler(async (req, res) => {
      const result = await controller.updateClinicProfessional(requireClinicPortalActor(), requireParam(req, "professionalId"), req.body as UpdateClinicProfessionalInput, buildRequestContext(req));
      res.json(toClinicProfessionalResponse(result));
    }),
  );

  router.get(
    "/clinic-portal/services",
    asyncHandler(async (req, res) => {
      const active = booleanQuery(req, "active");
      const kind = queryString(req, "kind");
      const result = await controller.listClinicServiceTypes(requireClinicPortalActor(), { ...(active === undefined ? {} : { active }), ...(kind === undefined ? {} : { kind }) });
      res.json(result.map(toClinicServiceTypeResponse));
    }),
  );

  router.post(
    "/clinic-portal/services",
    asyncHandler(async (req, res) => {
      const result = await controller.createClinicServiceType(requireClinicPortalActor(), req.body as CreateClinicServiceTypeInput, buildRequestContext(req));
      res.status(201).json(toClinicServiceTypeResponse(result));
    }),
  );

  router.patch(
    "/clinic-portal/services/:serviceTypeId",
    asyncHandler(async (req, res) => {
      const result = await controller.updateClinicServiceType(requireClinicPortalActor(), requireParam(req, "serviceTypeId"), req.body as UpdateClinicServiceTypeInput, buildRequestContext(req));
      res.json(toClinicServiceTypeResponse(result));
    }),
  );

  // --- Regras de horário (M14 a2, BR-CLN-12/13/15) ---

  router.get(
    "/clinic-portal/schedule-rules",
    asyncHandler(async (req, res) => {
      const active = booleanQuery(req, "active");
      const professionalId = queryString(req, "professionalId");
      const result = await controller.listClinicScheduleRules(requireClinicPortalActor(), {
        ...(professionalId === undefined ? {} : { professionalId }),
        ...(active === undefined ? {} : { active }),
      });
      res.json(result.map(toClinicScheduleRuleResponse));
    }),
  );

  router.post(
    "/clinic-portal/schedule-rules",
    asyncHandler(async (req, res) => {
      const result = await controller.createClinicScheduleRule(requireClinicPortalActor(), req.body as CreateClinicScheduleRuleInput, buildRequestContext(req));
      res.status(201).json(toClinicScheduleRuleResultResponse(result));
    }),
  );

  router.patch(
    "/clinic-portal/schedule-rules/:ruleId",
    asyncHandler(async (req, res) => {
      const result = await controller.updateClinicScheduleRule(requireClinicPortalActor(), requireParam(req, "ruleId"), req.body as UpdateClinicScheduleRuleInput, buildRequestContext(req));
      res.json(toClinicScheduleRuleResultResponse(result));
    }),
  );

  router.post(
    "/clinic-portal/schedule-rules/:ruleId/regenerate",
    asyncHandler(async (req, res) => {
      const result = await controller.regenerateClinicScheduleRule(requireClinicPortalActor(), requireParam(req, "ruleId"), buildRequestContext(req));
      res.json(toClinicScheduleRuleResultResponse(result));
    }),
  );

  // --- Bloqueios/férias (M14 a2, BR-CLN-14) ---

  router.get(
    "/clinic-portal/time-off",
    asyncHandler(async (req, res) => {
      const professionalId = queryString(req, "professionalId");
      const from = parseDateQuery(queryString(req, "from"), "from");
      const to = parseDateQuery(queryString(req, "to"), "to");
      const result = await controller.listClinicTimeOff(requireClinicPortalActor(), {
        ...(professionalId === undefined ? {} : { professionalId }),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      res.json(result.map(toClinicTimeOffResponse));
    }),
  );

  router.post(
    "/clinic-portal/time-off",
    asyncHandler(async (req, res) => {
      const result = await controller.createClinicTimeOff(requireClinicPortalActor(), req.body as CreateClinicTimeOffInput, buildRequestContext(req));
      res.status(201).json(toClinicTimeOffResultResponse(result));
    }),
  );

  router.delete(
    "/clinic-portal/time-off/:timeOffId",
    asyncHandler(async (req, res) => {
      const result = await controller.deleteClinicTimeOff(requireClinicPortalActor(), requireParam(req, "timeOffId"), buildRequestContext(req));
      res.json(toScheduleGenerationResponse(result));
    }),
  );

  return router;
}
