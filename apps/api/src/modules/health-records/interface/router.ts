// Controllers HTTP de registos de saúde (openapi.yaml operationIds: getBloodType, putBloodType,
// listAllergies, createAllergy, updateAllergy, deleteAllergy, listConditions, createCondition,
// updateCondition, deleteCondition — tag "Health records").
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { Allergy } from "../domain/allergy.js";
import type { BloodType } from "../domain/blood-type.js";
import type { MedicalCondition } from "../domain/medical-condition.js";
import type { CreateAllergyInput } from "../application/create-allergy.js";
import type { CreateConditionInput } from "../application/create-condition.js";
import type { ActorIdentity, RequestContext } from "../application/ports.js";
import type { PutBloodTypeInput } from "../application/put-blood-type.js";
import type { UpdateAllergyInput } from "../application/update-allergy.js";
import type { UpdateConditionInput } from "../application/update-condition.js";
import { toAllergyResponse, toBloodTypeResponse, toConditionResponse } from "./dto.js";

export interface HealthRecordsController {
  getBloodType: (actor: ActorIdentity, familyId: string, memberId: string, context: RequestContext) => Promise<BloodType>;
  putBloodType: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: PutBloodTypeInput,
    context: RequestContext,
  ) => Promise<BloodType>;
  listAllergies: (actor: ActorIdentity, familyId: string, memberId: string, context: RequestContext) => Promise<Allergy[]>;
  createAllergy: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: CreateAllergyInput,
    context: RequestContext,
  ) => Promise<Allergy>;
  updateAllergy: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    allergyId: string,
    input: UpdateAllergyInput,
    context: RequestContext,
  ) => Promise<Allergy>;
  deleteAllergy: (actor: ActorIdentity, familyId: string, memberId: string, allergyId: string, context: RequestContext) => Promise<void>;
  listConditions: (actor: ActorIdentity, familyId: string, memberId: string, context: RequestContext) => Promise<MedicalCondition[]>;
  createCondition: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: CreateConditionInput,
    context: RequestContext,
  ) => Promise<MedicalCondition>;
  updateCondition: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    conditionId: string,
    input: UpdateConditionInput,
    context: RequestContext,
  ) => Promise<MedicalCondition>;
  deleteCondition: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    conditionId: string,
    context: RequestContext,
  ) => Promise<void>;
}

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

export function createHealthRecordsRouter(controller: HealthRecordsController): Router {
  const router = Router();

  router.get(
    "/families/:familyId/members/:memberId/blood-type",
    asyncHandler(async (req, res) => {
      const result = await controller.getBloodType(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        buildRequestContext(req),
      );
      res.json(toBloodTypeResponse(result));
    }),
  );

  router.put(
    "/families/:familyId/members/:memberId/blood-type",
    asyncHandler(async (req, res) => {
      const result = await controller.putBloodType(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as PutBloodTypeInput,
        buildRequestContext(req),
      );
      res.json(toBloodTypeResponse(result));
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/allergies",
    asyncHandler(async (req, res) => {
      const result = await controller.listAllergies(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        buildRequestContext(req),
      );
      res.json(result.map(toAllergyResponse));
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/allergies",
    asyncHandler(async (req, res) => {
      const result = await controller.createAllergy(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as CreateAllergyInput,
        buildRequestContext(req),
      );
      res.status(201).json(toAllergyResponse(result));
    }),
  );

  router.patch(
    "/families/:familyId/members/:memberId/allergies/:allergyId",
    asyncHandler(async (req, res) => {
      const result = await controller.updateAllergy(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "allergyId"),
        req.body as UpdateAllergyInput,
        buildRequestContext(req),
      );
      res.json(toAllergyResponse(result));
    }),
  );

  router.delete(
    "/families/:familyId/members/:memberId/allergies/:allergyId",
    asyncHandler(async (req, res) => {
      await controller.deleteAllergy(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "allergyId"),
        buildRequestContext(req),
      );
      res.status(204).end();
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/conditions",
    asyncHandler(async (req, res) => {
      const result = await controller.listConditions(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        buildRequestContext(req),
      );
      res.json(result.map(toConditionResponse));
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/conditions",
    asyncHandler(async (req, res) => {
      const result = await controller.createCondition(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as CreateConditionInput,
        buildRequestContext(req),
      );
      res.status(201).json(toConditionResponse(result));
    }),
  );

  router.patch(
    "/families/:familyId/members/:memberId/conditions/:conditionId",
    asyncHandler(async (req, res) => {
      const result = await controller.updateCondition(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "conditionId"),
        req.body as UpdateConditionInput,
        buildRequestContext(req),
      );
      res.json(toConditionResponse(result));
    }),
  );

  router.delete(
    "/families/:familyId/members/:memberId/conditions/:conditionId",
    asyncHandler(async (req, res) => {
      await controller.deleteCondition(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "conditionId"),
        buildRequestContext(req),
      );
      res.status(204).end();
    }),
  );

  return router;
}
