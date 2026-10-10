// Controllers HTTP de `medications` (openapi.yaml operationIds: listMedicationPlans,
// createMedicationPlan, getMedicationPlan, updateMedicationPlan, setMedicationPlanStatus,
// deleteMedicationPlan, listDoses, markDoseTaken, markDoseNotTaken, correctDose,
// medicationAdherence — tags "Medications").
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { DoseOccurrence } from "../domain/dose-occurrence.js";
import type { MedicationPlan } from "../domain/medication-plan.js";
import type { CreateMedicationPlanInput } from "../application/create-plan.js";
import type { DoseCorrectionInput } from "../application/correct-dose.js";
import type { DoseActionInput } from "../application/mark-dose-taken.js";
import type { AdherenceItem, ActorIdentity, CursorPage, RequestContext } from "../application/ports.js";
import type { ListDosesQuery } from "../application/list-doses.js";
import type { ListMedicationPlansQuery } from "../application/list-plans.js";
import type { MedicationAdherenceQuery } from "../application/medication-adherence.js";
import type { SetPlanStatusInput } from "../application/set-plan-status.js";
import type { UpdateMedicationPlanInput } from "../application/update-plan.js";
import { toAdherenceResponse, toDosePage, toDoseResponse, toMedicationPlanPage, toMedicationPlanResponse } from "./dto.js";

export interface MedicationsController {
  listPlans: (actor: ActorIdentity, familyId: string, memberId: string, query: ListMedicationPlansQuery, context: RequestContext) => Promise<CursorPage<MedicationPlan>>;
  createPlan: (actor: ActorIdentity, familyId: string, memberId: string, input: CreateMedicationPlanInput, context: RequestContext) => Promise<MedicationPlan>;
  getPlan: (actor: ActorIdentity, familyId: string, memberId: string, planId: string, context: RequestContext) => Promise<MedicationPlan>;
  updatePlan: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    planId: string,
    input: UpdateMedicationPlanInput,
    context: RequestContext,
  ) => Promise<MedicationPlan>;
  setPlanStatus: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    planId: string,
    input: SetPlanStatusInput,
    context: RequestContext,
  ) => Promise<MedicationPlan>;
  deletePlan: (actor: ActorIdentity, familyId: string, memberId: string, planId: string, context: RequestContext) => Promise<void>;
  listDoses: (actor: ActorIdentity, familyId: string, memberId: string, query: ListDosesQuery, context: RequestContext) => Promise<CursorPage<DoseOccurrence>>;
  markDoseTaken: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    doseId: string,
    input: DoseActionInput,
    context: RequestContext,
  ) => Promise<DoseOccurrence>;
  markDoseNotTaken: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    doseId: string,
    input: DoseActionInput,
    context: RequestContext,
  ) => Promise<DoseOccurrence>;
  correctDose: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    doseId: string,
    input: DoseCorrectionInput,
    context: RequestContext,
  ) => Promise<DoseOccurrence>;
  medicationAdherence: (actor: ActorIdentity, familyId: string, memberId: string, query: MedicationAdherenceQuery, context: RequestContext) => Promise<AdherenceItem[]>;
}

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

function queryString(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

export function createMedicationsRouter(controller: MedicationsController): Router {
  const router = Router();

  router.get(
    "/families/:familyId/members/:memberId/medication-plans",
    asyncHandler(async (req, res) => {
      const status = queryString(req, "status");
      const limit = queryString(req, "limit");
      const cursor = queryString(req, "cursor");
      const query: ListMedicationPlansQuery = { ...(status ? { status } : {}), ...(limit ? { limit } : {}), ...(cursor ? { cursor } : {}) };
      const result = await controller.listPlans(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), query, buildRequestContext(req));
      res.json(toMedicationPlanPage(result));
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/medication-plans",
    asyncHandler(async (req, res) => {
      const result = await controller.createPlan(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as CreateMedicationPlanInput,
        buildRequestContext(req),
      );
      res.status(201).json(toMedicationPlanResponse(result));
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/medication-plans/:planId",
    asyncHandler(async (req, res) => {
      const result = await controller.getPlan(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "planId"), buildRequestContext(req));
      res.json(toMedicationPlanResponse(result));
    }),
  );

  router.patch(
    "/families/:familyId/members/:memberId/medication-plans/:planId",
    asyncHandler(async (req, res) => {
      const result = await controller.updatePlan(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "planId"),
        req.body as UpdateMedicationPlanInput,
        buildRequestContext(req),
      );
      res.json(toMedicationPlanResponse(result));
    }),
  );

  router.put(
    "/families/:familyId/members/:memberId/medication-plans/:planId/status",
    asyncHandler(async (req, res) => {
      const result = await controller.setPlanStatus(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "planId"),
        req.body as SetPlanStatusInput,
        buildRequestContext(req),
      );
      res.json(toMedicationPlanResponse(result));
    }),
  );

  router.delete(
    "/families/:familyId/members/:memberId/medication-plans/:planId",
    asyncHandler(async (req, res) => {
      await controller.deletePlan(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "planId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/doses",
    asyncHandler(async (req, res) => {
      const from = queryString(req, "from");
      const to = queryString(req, "to");
      const status = queryString(req, "status");
      const planId = queryString(req, "planId");
      const limit = queryString(req, "limit");
      const cursor = queryString(req, "cursor");
      const query: ListDosesQuery = {
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(status ? { status } : {}),
        ...(planId ? { planId } : {}),
        ...(limit ? { limit } : {}),
        ...(cursor ? { cursor } : {}),
      };
      const result = await controller.listDoses(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), query, buildRequestContext(req));
      res.json(toDosePage(result));
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/doses/:doseId/taken",
    asyncHandler(async (req, res) => {
      const result = await controller.markDoseTaken(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "doseId"),
        req.body as DoseActionInput,
        buildRequestContext(req),
      );
      res.json(toDoseResponse(result));
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/doses/:doseId/not-taken",
    asyncHandler(async (req, res) => {
      const result = await controller.markDoseNotTaken(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "doseId"),
        req.body as DoseActionInput,
        buildRequestContext(req),
      );
      res.json(toDoseResponse(result));
    }),
  );

  router.put(
    "/families/:familyId/members/:memberId/doses/:doseId",
    asyncHandler(async (req, res) => {
      const result = await controller.correctDose(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "doseId"),
        req.body as DoseCorrectionInput,
        buildRequestContext(req),
      );
      res.json(toDoseResponse(result));
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/medication-adherence",
    asyncHandler(async (req, res) => {
      const from = queryString(req, "from");
      const to = queryString(req, "to");
      const query: MedicationAdherenceQuery = { ...(from ? { from } : {}), ...(to ? { to } : {}) };
      const result = await controller.medicationAdherence(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), query, buildRequestContext(req));
      res.json(toAdherenceResponse(result));
    }),
  );

  return router;
}
