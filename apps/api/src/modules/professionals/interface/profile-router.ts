// Controllers HTTP de `/professional-portal/me`, `/me/specialties` e `/submission` (tag «Professional Portal»; UC-MKT-03/05/12).
// O profissional é SEMPRE o do token (`getProfessionalActor`): nenhuma rota recebe um `professionalId` do pedido.
import { Router } from "express";
import { getProfessionalActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, type RequestContext } from "../../../platform/http/index.js";
import type { ProfessionalActor, ProfessionalProfileView } from "../application/profile.js";

export interface ProfileController {
  getMe: (actor: ProfessionalActor) => Promise<ProfessionalProfileView>;
  updateMe: (actor: ProfessionalActor, input: Record<string, unknown>, ctx: RequestContext) => Promise<ProfessionalProfileView>;
  setSpecialties: (actor: ProfessionalActor, input: { specialtyIds: unknown }, ctx: RequestContext) => Promise<ProfessionalProfileView>;
  submit: (actor: ProfessionalActor, ctx: RequestContext) => Promise<ProfessionalProfileView>;
}

export function requireProfessionalActor(): ProfessionalActor & { sessionId: string } {
  const actor = getProfessionalActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return actor;
}

export function toProfileResponse(view: ProfessionalProfileView) {
  return {
    id: view.id,
    email: view.email,
    displayName: view.displayName,
    bio: view.bio,
    city: view.city,
    paymentInstructions: view.paymentInstructions,
    validationStatus: view.validationStatus,
    statusReason: view.statusReason,
    statusChangedAt: view.statusChangedAt.toISOString(),
    submittedAt: view.submittedAt?.toISOString() ?? null,
    approvedAt: view.approvedAt?.toISOString() ?? null,
    specialties: view.specialties,
    requirements: view.requirements,
  };
}

export function createProfileRouter(controller: ProfileController): Router {
  const router = Router();
  const noStore = (res: { set: (k: string, v: string) => unknown }) => res.set("Cache-Control", "no-store");

  router.get(
    "/professional-portal/me",
    asyncHandler(async (_req, res) => {
      noStore(res);
      res.json(toProfileResponse(await controller.getMe(requireProfessionalActor())));
    }),
  );
  router.patch(
    "/professional-portal/me",
    asyncHandler(async (req, res) => {
      noStore(res);
      res.json(toProfileResponse(await controller.updateMe(requireProfessionalActor(), req.body as Record<string, unknown>, buildRequestContext(req))));
    }),
  );
  router.put(
    "/professional-portal/me/specialties",
    asyncHandler(async (req, res) => {
      noStore(res);
      res.json(toProfileResponse(await controller.setSpecialties(requireProfessionalActor(), req.body as { specialtyIds: unknown }, buildRequestContext(req))));
    }),
  );
  router.post(
    "/professional-portal/submission",
    asyncHandler(async (req, res) => {
      noStore(res);
      res.json(toProfileResponse(await controller.submit(requireProfessionalActor(), buildRequestContext(req))));
    }),
  );
  return router;
}
