// Controllers HTTP de partilha (openapi.yaml operationIds: getSharing, putSharing, sharedWithMe —
// tag "Sharing").
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { ActorIdentity } from "../application/get-sharing.js";
import type { PutSharingInput } from "../application/put-sharing.js";
import type { RequestContext } from "../application/ports.js";
import type { SharedWithMeItemView, SharingSettingsView } from "../application/sharing-view.js";
import { toSharedWithMeResponse, toSharingSettingsResponse } from "./dto.js";

export interface AccessController {
  getSharing: (actor: ActorIdentity, familyId: string, memberId: string) => Promise<SharingSettingsView>;
  putSharing: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: PutSharingInput,
    ctx: RequestContext,
  ) => Promise<SharingSettingsView>;
  sharedWithMe: (actor: ActorIdentity, familyId: string) => Promise<SharedWithMeItemView[]>;
}

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

export function createAccessRouter(controller: AccessController): Router {
  const router = Router();

  router.get(
    "/families/:familyId/members/:memberId/sharing",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const result = await controller.getSharing(actor, requireParam(req, "familyId"), requireParam(req, "memberId"));
      res.json(toSharingSettingsResponse(result));
    }),
  );

  router.put(
    "/families/:familyId/members/:memberId/sharing",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const result = await controller.putSharing(
        actor,
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as PutSharingInput,
        buildRequestContext(req),
      );
      res.json(toSharingSettingsResponse(result));
    }),
  );

  router.get(
    "/families/:familyId/shared-with-me",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const result = await controller.sharedWithMe(actor, requireParam(req, "familyId"));
      res.json(toSharedWithMeResponse(result));
    }),
  );

  return router;
}
