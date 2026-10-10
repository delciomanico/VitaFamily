// Controllers HTTP de `clinics` (openapi.yaml operationIds: listClinics, createPrivateClinic,
// updatePrivateClinic, setPrivateClinicStatus, deletePrivateClinic — tag "Clinics").
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { CreatePrivateClinicInput } from "../application/create-private-clinic.js";
import type { ListClinicsQuery } from "../application/list-clinics.js";
import type { ActorIdentity, Clinic, RequestContext } from "../application/ports.js";
import type { SetPrivateClinicStatusInput } from "../application/set-private-clinic-status.js";
import type { UpdatePrivateClinicInput } from "../application/update-private-clinic.js";
import { toClinicListResponse, toClinicResponse } from "./dto.js";

export interface ClinicsController {
  listClinics: (actor: ActorIdentity, familyId: string, query: ListClinicsQuery) => Promise<Clinic[]>;
  createPrivateClinic: (actor: ActorIdentity, familyId: string, input: CreatePrivateClinicInput, context: RequestContext) => Promise<Clinic>;
  updatePrivateClinic: (actor: ActorIdentity, familyId: string, clinicId: string, input: UpdatePrivateClinicInput, context: RequestContext) => Promise<Clinic>;
  setPrivateClinicStatus: (actor: ActorIdentity, familyId: string, clinicId: string, input: SetPrivateClinicStatusInput, context: RequestContext) => Promise<Clinic>;
  deletePrivateClinic: (actor: ActorIdentity, familyId: string, clinicId: string, context: RequestContext) => Promise<void>;
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

export function createClinicsRouter(controller: ClinicsController): Router {
  const router = Router();

  router.get(
    "/families/:familyId/clinics",
    asyncHandler(async (req, res) => {
      const status = queryString(req, "status");
      const result = await controller.listClinics(requireActor(), requireParam(req, "familyId"), { ...(status ? { status } : {}) });
      res.json(toClinicListResponse(result));
    }),
  );

  router.post(
    "/families/:familyId/clinics",
    asyncHandler(async (req, res) => {
      const result = await controller.createPrivateClinic(requireActor(), requireParam(req, "familyId"), req.body as CreatePrivateClinicInput, buildRequestContext(req));
      res.status(201).json(toClinicResponse(result));
    }),
  );

  router.patch(
    "/families/:familyId/clinics/:clinicId",
    asyncHandler(async (req, res) => {
      const result = await controller.updatePrivateClinic(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "clinicId"),
        req.body as UpdatePrivateClinicInput,
        buildRequestContext(req),
      );
      res.json(toClinicResponse(result));
    }),
  );

  router.put(
    "/families/:familyId/clinics/:clinicId/status",
    asyncHandler(async (req, res) => {
      const result = await controller.setPrivateClinicStatus(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "clinicId"),
        req.body as SetPrivateClinicStatusInput,
        buildRequestContext(req),
      );
      res.json(toClinicResponse(result));
    }),
  );

  router.delete(
    "/families/:familyId/clinics/:clinicId",
    asyncHandler(async (req, res) => {
      await controller.deletePrivateClinic(requireActor(), requireParam(req, "familyId"), requireParam(req, "clinicId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  return router;
}
