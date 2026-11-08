// Controllers HTTP do lado família (openapi.yaml operationIds: listClinicConsents, putClinicConsent,
// revokeClinicConsent, createClinicLinkCode — tag "Clinics", M14 P, authorization.md §6.4). O ator é o `User`.
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { ClinicConsentView, ClinicLinkCodeView } from "../application/consents.js";
import type { ActorIdentity } from "../application/ports.js";

export interface ClinicPatientsFamilyController {
  listClinicConsents: (actor: ActorIdentity, familyId: string, memberId: string) => Promise<ClinicConsentView[]>;
  putClinicConsent: (actor: ActorIdentity, familyId: string, memberId: string, clinicId: string, input: { level: unknown }, context: RequestContext) => Promise<ClinicConsentView>;
  revokeClinicConsent: (actor: ActorIdentity, familyId: string, memberId: string, clinicId: string, context: RequestContext) => Promise<void>;
  createClinicLinkCode: (actor: ActorIdentity, familyId: string, memberId: string, context: RequestContext) => Promise<ClinicLinkCodeView>;
}

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

export function createClinicPatientsFamilyRouter(controller: ClinicPatientsFamilyController): Router {
  const router = Router();
  const base = "/families/:familyId/members/:memberId";

  router.get(
    `${base}/clinic-consents`,
    asyncHandler(async (req, res) => {
      res.json(await controller.listClinicConsents(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId")));
    }),
  );

  router.put(
    `${base}/clinic-consents/:clinicId`,
    asyncHandler(async (req, res) => {
      const body = req.body as { level?: unknown };
      res.json(
        await controller.putClinicConsent(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "clinicId"), { level: body.level }, buildRequestContext(req)),
      );
    }),
  );

  router.delete(
    `${base}/clinic-consents/:clinicId`,
    asyncHandler(async (req, res) => {
      await controller.revokeClinicConsent(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "clinicId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.post(
    `${base}/clinic-link-codes`,
    asyncHandler(async (req, res) => {
      res.status(201).json(await controller.createClinicLinkCode(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), buildRequestContext(req)));
    }),
  );

  return router;
}
