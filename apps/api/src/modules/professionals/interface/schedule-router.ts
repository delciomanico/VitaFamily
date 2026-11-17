// Controllers HTTP de `/professional-portal/schedule-rules*`, `/time-off*` e `/slots` (UC-MKT-09). O profissional é sempre o do token.
import { Router } from "express";
import { ValidationError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import type { ProfessionalActor } from "../application/profile.js";
import type { ScheduleRuleRecord, SlotRecord, TimeOffRecord } from "../application/ports.js";
import type { ScheduleRuleResult } from "../application/schedule.js";
import { booleanQuery } from "./offers-router.js";
import { requireProfessionalActor } from "./profile-router.js";

export interface ScheduleController {
  listScheduleRules: (actor: ProfessionalActor, filter: { offerId?: string; active?: boolean }) => Promise<ScheduleRuleRecord[]>;
  createScheduleRule: (actor: ProfessionalActor, input: Record<string, unknown>, ctx: RequestContext) => Promise<ScheduleRuleResult>;
  updateScheduleRule: (actor: ProfessionalActor, ruleId: string, input: Record<string, unknown>, ctx: RequestContext) => Promise<ScheduleRuleResult>;
  listTimeOff: (actor: ProfessionalActor, filter: { from?: Date; to?: Date }) => Promise<TimeOffRecord[]>;
  createTimeOff: (actor: ProfessionalActor, input: { startsAt: unknown; endsAt: unknown; reason?: unknown }, ctx: RequestContext) => Promise<TimeOffRecord>;
  deleteTimeOff: (actor: ProfessionalActor, timeOffId: string, ctx: RequestContext) => Promise<void>;
  listSlots: (actor: ProfessionalActor, range: { from: Date; to: Date }) => Promise<SlotRecord[]>;
}

const toRuleResponse = (r: ScheduleRuleRecord) => ({ id: r.id, offerId: r.offerId, weekdays: r.weekdays, startTime: r.startTime, endTime: r.endTime, validFrom: r.validFrom, validUntil: r.validUntil, active: r.active });
const toTimeOffResponse = (t: TimeOffRecord) => ({ id: t.id, startsAt: t.startsAt.toISOString(), endsAt: t.endsAt.toISOString(), reason: t.reason });
const toSlotResponse = (s: SlotRecord) => ({ id: s.id, offerId: s.offerId, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() });
const toResult = (r: ScheduleRuleResult) => ({ rule: toRuleResponse(r.rule), generation: r.generation });

function dateQuery(value: unknown, field: string): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ValidationError([{ field, message: "data/hora inválida" }], { detail: "Filtro inválido." });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ValidationError([{ field, message: "data/hora inválida" }], { detail: "Filtro inválido." });
  return date;
}

export function createScheduleRouter(controller: ScheduleController): Router {
  const router = Router();

  router.get(
    "/professional-portal/schedule-rules",
    asyncHandler(async (req, res) => {
      const active = booleanQuery(req.query.active, "active");
      const offerId = typeof req.query.offerId === "string" ? req.query.offerId : undefined;
      const rules = await controller.listScheduleRules(requireProfessionalActor(), { ...(offerId ? { offerId } : {}), ...(active !== undefined ? { active } : {}) });
      res.set("Cache-Control", "no-store").json(rules.map(toRuleResponse));
    }),
  );
  router.post(
    "/professional-portal/schedule-rules",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").status(201).json(toResult(await controller.createScheduleRule(requireProfessionalActor(), req.body as Record<string, unknown>, buildRequestContext(req))));
    }),
  );
  router.patch(
    "/professional-portal/schedule-rules/:ruleId",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(toResult(await controller.updateScheduleRule(requireProfessionalActor(), requireParam(req, "ruleId"), req.body as Record<string, unknown>, buildRequestContext(req))));
    }),
  );

  router.get(
    "/professional-portal/time-off",
    asyncHandler(async (req, res) => {
      const from = dateQuery(req.query.from, "from");
      const to = dateQuery(req.query.to, "to");
      const list = await controller.listTimeOff(requireProfessionalActor(), { ...(from ? { from } : {}), ...(to ? { to } : {}) });
      res.set("Cache-Control", "no-store").json(list.map(toTimeOffResponse));
    }),
  );
  router.post(
    "/professional-portal/time-off",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").status(201).json(toTimeOffResponse(await controller.createTimeOff(requireProfessionalActor(), req.body as { startsAt: unknown; endsAt: unknown; reason?: unknown }, buildRequestContext(req))));
    }),
  );
  router.delete(
    "/professional-portal/time-off/:timeOffId",
    asyncHandler(async (req, res) => {
      await controller.deleteTimeOff(requireProfessionalActor(), requireParam(req, "timeOffId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.get(
    "/professional-portal/slots",
    asyncHandler(async (req, res) => {
      const from = dateQuery(req.query.from, "from");
      const to = dateQuery(req.query.to, "to");
      if (!from || !to) throw new ValidationError([{ field: "from", message: "from e to são obrigatórios" }], { detail: "Intervalo inválido." });
      const slots = await controller.listSlots(requireProfessionalActor(), { from, to });
      res.set("Cache-Control", "no-store").json(slots.map(toSlotResponse));
    }),
  );
  return router;
}
