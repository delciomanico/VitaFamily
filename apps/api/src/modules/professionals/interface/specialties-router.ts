// Controllers HTTP do catálogo de especialidades (tags «Professional Portal» e «Admin»; UC-MKT-03/07, BR-MKT-22).
// Respostas exatamente com os campos de `Specialty` / `AdminSpecialty` (openapi.yaml).
import { Router } from "express";
import { getActor, getProfessionalActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { AdminSpecialty, PortalSpecialty, SpecialtyActor, SpecialtyCreateInput, SpecialtyUpdateInput } from "../application/specialties.js";
import type { RequestContext } from "../application/ports.js";

export interface SpecialtiesController {
  listPortalSpecialties: () => Promise<PortalSpecialty[]>;
  adminListSpecialties: (actor: SpecialtyActor) => Promise<AdminSpecialty[]>;
  adminCreateSpecialty: (actor: SpecialtyActor, input: SpecialtyCreateInput, context: RequestContext) => Promise<AdminSpecialty>;
  adminUpdateSpecialty: (actor: SpecialtyActor, specialtyId: string, input: SpecialtyUpdateInput, context: RequestContext) => Promise<AdminSpecialty>;
}

function requireProfessionalPortalActor(): void {
  if (!getProfessionalActor()) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
}

function requireAdminActor(): SpecialtyActor {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

function adminView(specialty: AdminSpecialty) {
  return { id: specialty.id, name: specialty.name, category: specialty.category, active: specialty.active, professionalCount: specialty.professionalCount };
}

export function createSpecialtiesRouter(controller: SpecialtiesController): Router {
  const router = Router();

  router.get(
    "/professional-portal/specialties",
    asyncHandler(async (_req, res) => {
      requireProfessionalPortalActor();
      const specialties = await controller.listPortalSpecialties();
      res.set("Cache-Control", "no-store").json(specialties.map((s) => ({ id: s.id, name: s.name, category: s.category })));
    }),
  );

  router.get(
    "/admin/specialties",
    asyncHandler(async (_req, res) => {
      const specialties = await controller.adminListSpecialties(requireAdminActor());
      res.json(specialties.map(adminView));
    }),
  );

  router.post(
    "/admin/specialties",
    asyncHandler(async (req, res) => {
      const created = await controller.adminCreateSpecialty(requireAdminActor(), req.body as SpecialtyCreateInput, buildRequestContext(req));
      res.status(201).json(adminView(created));
    }),
  );

  router.patch(
    "/admin/specialties/:specialtyId",
    asyncHandler(async (req, res) => {
      const updated = await controller.adminUpdateSpecialty(requireAdminActor(), requireParam(req, "specialtyId"), req.body as SpecialtyUpdateInput, buildRequestContext(req));
      res.json(adminView(updated));
    }),
  );

  return router;
}
