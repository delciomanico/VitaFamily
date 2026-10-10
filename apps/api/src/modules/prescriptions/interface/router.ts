// Controllers HTTP de `prescriptions` (openapi.yaml operationIds: listPrescriptions,
// createPrescription, getPrescription, updatePrescription, deletePrescription,
// setPrescriptionStatus, addPrescriptionMedication — tag "Prescriptions").
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { CreatePrescriptionInput } from "../application/create-prescription.js";
import type { ListPrescriptionsQuery } from "../application/list-prescriptions.js";
import type { ActorIdentity, CreateMedicationPlanInput, CursorPage, MedicationPlan, RequestContext } from "../application/ports.js";
import type { PrescriptionView } from "../application/prescription-view.js";
import type { SetPrescriptionStatusInput } from "../application/set-prescription-status.js";
import type { UpdatePrescriptionInput } from "../application/update-prescription.js";
import { toEmbeddedMedicationPlan, toPrescriptionPage, toPrescriptionResponse } from "./dto.js";

export interface PrescriptionsController {
  listPrescriptions: (actor: ActorIdentity, familyId: string, memberId: string, query: ListPrescriptionsQuery, context: RequestContext) => Promise<CursorPage<PrescriptionView>>;
  createPrescription: (actor: ActorIdentity, familyId: string, memberId: string, input: CreatePrescriptionInput, context: RequestContext) => Promise<PrescriptionView>;
  getPrescription: (actor: ActorIdentity, familyId: string, memberId: string, prescriptionId: string, context: RequestContext) => Promise<PrescriptionView>;
  updatePrescription: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    prescriptionId: string,
    input: UpdatePrescriptionInput,
    context: RequestContext,
  ) => Promise<PrescriptionView>;
  deletePrescription: (actor: ActorIdentity, familyId: string, memberId: string, prescriptionId: string, context: RequestContext) => Promise<void>;
  setPrescriptionStatus: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    prescriptionId: string,
    input: SetPrescriptionStatusInput,
    context: RequestContext,
  ) => Promise<PrescriptionView>;
  addPrescriptionMedication: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    prescriptionId: string,
    input: CreateMedicationPlanInput,
    context: RequestContext,
  ) => Promise<MedicationPlan>;
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

export function createPrescriptionsRouter(controller: PrescriptionsController): Router {
  const router = Router();

  router.get(
    "/families/:familyId/members/:memberId/prescriptions",
    asyncHandler(async (req, res) => {
      const status = queryString(req, "status");
      const limit = queryString(req, "limit");
      const cursor = queryString(req, "cursor");
      const query: ListPrescriptionsQuery = { ...(status ? { status } : {}), ...(limit ? { limit } : {}), ...(cursor ? { cursor } : {}) };
      const result = await controller.listPrescriptions(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), query, buildRequestContext(req));
      res.json(toPrescriptionPage(result));
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/prescriptions",
    asyncHandler(async (req, res) => {
      const result = await controller.createPrescription(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as CreatePrescriptionInput,
        buildRequestContext(req),
      );
      res.status(201).json(toPrescriptionResponse(result));
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/prescriptions/:prescriptionId",
    asyncHandler(async (req, res) => {
      const result = await controller.getPrescription(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "prescriptionId"), buildRequestContext(req));
      res.json(toPrescriptionResponse(result));
    }),
  );

  router.patch(
    "/families/:familyId/members/:memberId/prescriptions/:prescriptionId",
    asyncHandler(async (req, res) => {
      const result = await controller.updatePrescription(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "prescriptionId"),
        req.body as UpdatePrescriptionInput,
        buildRequestContext(req),
      );
      res.json(toPrescriptionResponse(result));
    }),
  );

  router.delete(
    "/families/:familyId/members/:memberId/prescriptions/:prescriptionId",
    asyncHandler(async (req, res) => {
      await controller.deletePrescription(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "prescriptionId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.put(
    "/families/:familyId/members/:memberId/prescriptions/:prescriptionId/status",
    asyncHandler(async (req, res) => {
      const result = await controller.setPrescriptionStatus(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "prescriptionId"),
        req.body as SetPrescriptionStatusInput,
        buildRequestContext(req),
      );
      res.json(toPrescriptionResponse(result));
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/prescriptions/:prescriptionId/medications",
    asyncHandler(async (req, res) => {
      const result = await controller.addPrescriptionMedication(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "prescriptionId"),
        req.body as CreateMedicationPlanInput,
        buildRequestContext(req),
      );
      res.status(201).json(toEmbeddedMedicationPlan(result));
    }),
  );

  return router;
}
