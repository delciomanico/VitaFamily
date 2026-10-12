// Controllers HTTP de `lifecycle` (openapi.yaml operationIds: requestMyExport, getMyExport,
// downloadMyExport, requestDependentExport — tags "Users"/"Families").
import type { Readable } from "node:stream";
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { DependentTarget, ExportView } from "../application/exports.js";
import type { ActorIdentity, RequestContext } from "../application/ports.js";

export interface LifecycleController {
  requestExport: (actor: ActorIdentity, target: DependentTarget | undefined, context: RequestContext) => Promise<ExportView>;
  getExport: (actor: ActorIdentity, exportId: string) => Promise<ExportView>;
  deleteAccount: (actor: ActorIdentity, password: string, context: RequestContext) => Promise<void>;
  downloadExport: (actor: ActorIdentity, exportId: string, context: RequestContext) => Promise<{ fileName: string; stream: Readable }>;
}

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

function toResponse(view: ExportView) {
  return {
    id: view.id,
    status: view.status,
    reason: view.reason,
    requestedAt: view.requestedAt.toISOString(),
    expiresAt: view.expiresAt ? view.expiresAt.toISOString() : null,
  };
}

export function createLifecycleRouter(controller: LifecycleController): Router {
  const router = Router();

  router.post(
    "/users/me/exports",
    asyncHandler(async (req, res) => {
      res.status(202).json(toResponse(await controller.requestExport(requireActor(), undefined, buildRequestContext(req))));
    }),
  );

  router.get(
    "/users/me/exports/:exportId",
    asyncHandler(async (req, res) => {
      res.json(toResponse(await controller.getExport(requireActor(), requireParam(req, "exportId"))));
    }),
  );

  router.get(
    "/users/me/exports/:exportId/download",
    asyncHandler(async (req, res) => {
      const { fileName, stream } = await controller.downloadExport(requireActor(), requireParam(req, "exportId"), buildRequestContext(req));
      // ADR-006: nunca cacheável, entrega mediada (nunca URL pública).
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      stream.on("error", () => res.destroy());
      stream.pipe(res);
    }),
  );

  router.delete(
    "/users/me",
    asyncHandler(async (req, res) => {
      const body = req.body as { password: string };
      await controller.deleteAccount(requireActor(), body.password, buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/exports",
    asyncHandler(async (req, res) => {
      const target = { familyId: requireParam(req, "familyId"), memberId: requireParam(req, "memberId") };
      res.status(202).json(toResponse(await controller.requestExport(requireActor(), target, buildRequestContext(req))));
    }),
  );

  return router;
}
