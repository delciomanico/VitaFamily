// Controllers HTTP de `/admin/clinics` (openapi.yaml operationIds: adminListClinics,
// adminCreateClinic, adminUpdateClinic, adminSetClinicStatus — tag "Admin"). Sem módulo `admin`
// ainda (M9); montado diretamente em `main/api.ts` (ver `clinics/index.ts`).
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { AdminClinicListQuery, AdminCreateClinicInput, AdminSetClinicStatusInput, AdminUpdateClinicInput } from "../application/admin-clinics.js";
import type { ActorIdentity, Clinic, RequestContext } from "../application/ports.js";
import { toClinicListResponse, toClinicResponse } from "./dto.js";

export interface ClinicsAdminController {
  adminListClinics: (actor: ActorIdentity, query: AdminClinicListQuery) => Promise<Clinic[]>;
  adminCreateClinic: (actor: ActorIdentity, input: AdminCreateClinicInput, context: RequestContext) => Promise<Clinic>;
  adminUpdateClinic: (actor: ActorIdentity, clinicId: string, input: AdminUpdateClinicInput, context: RequestContext) => Promise<Clinic>;
  adminSetClinicStatus: (actor: ActorIdentity, clinicId: string, input: AdminSetClinicStatusInput, context: RequestContext) => Promise<Clinic>;
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

export function createClinicsAdminRouter(controller: ClinicsAdminController): Router {
  const router = Router();

  router.get(
    "/admin/clinics",
    asyncHandler(async (req, res) => {
      const status = queryString(req, "status");
      const result = await controller.adminListClinics(requireActor(), { ...(status ? { status } : {}) });
      res.json(toClinicListResponse(result));
    }),
  );

  router.post(
    "/admin/clinics",
    asyncHandler(async (req, res) => {
      const result = await controller.adminCreateClinic(requireActor(), req.body as AdminCreateClinicInput, buildRequestContext(req));
      res.status(201).json(toClinicResponse(result));
    }),
  );

  router.patch(
    "/admin/clinics/:clinicId",
    asyncHandler(async (req, res) => {
      const result = await controller.adminUpdateClinic(requireActor(), requireParam(req, "clinicId"), req.body as AdminUpdateClinicInput, buildRequestContext(req));
      res.json(toClinicResponse(result));
    }),
  );

  router.put(
    "/admin/clinics/:clinicId/status",
    asyncHandler(async (req, res) => {
      const result = await controller.adminSetClinicStatus(requireActor(), requireParam(req, "clinicId"), req.body as AdminSetClinicStatusInput, buildRequestContext(req));
      res.json(toClinicResponse(result));
    }),
  );

  return router;
}
