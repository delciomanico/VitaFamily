// Controllers HTTP de `/admin/insurers` (openapi operationIds: adminListInsurers, adminCreateInsurer,
// adminUpdateInsurer, adminSetInsurerStatus, adminCreateOrResetInsurerRootAccount — tag "Admin").
// Montado diretamente em `main/api.ts` (mesmo critério de `clinics.adminRouter`).
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type {
  AdminCreateInsurerInput,
  AdminInsurerRootAccountInput,
  AdminSetInsurerStatusInput,
  AdminUpdateInsurerInput,
} from "../application/admin-insurers.js";
import type { ActorIdentity, InsuranceAccount, Insurer, RequestContext } from "../application/ports.js";
import { toInsuranceAccountResponse, toInsurerResponse } from "./dto.js";

export interface InsuranceAdminController {
  adminListInsurers: (actor: ActorIdentity) => Promise<Insurer[]>;
  adminCreateInsurer: (actor: ActorIdentity, input: AdminCreateInsurerInput, context: RequestContext) => Promise<Insurer>;
  adminUpdateInsurer: (actor: ActorIdentity, insurerId: string, input: AdminUpdateInsurerInput, context: RequestContext) => Promise<Insurer>;
  adminSetInsurerStatus: (actor: ActorIdentity, insurerId: string, input: AdminSetInsurerStatusInput, context: RequestContext) => Promise<Insurer>;
  adminCreateOrResetInsurerRootAccount: (actor: ActorIdentity, insurerId: string, input: AdminInsurerRootAccountInput, context: RequestContext) => Promise<InsuranceAccount>;
}

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

export function createInsuranceAdminRouter(controller: InsuranceAdminController): Router {
  const router = Router();

  router.get(
    "/admin/insurers",
    asyncHandler(async (_req, res) => {
      res.json((await controller.adminListInsurers(requireActor())).map(toInsurerResponse));
    }),
  );

  router.post(
    "/admin/insurers",
    asyncHandler(async (req, res) => {
      const result = await controller.adminCreateInsurer(requireActor(), req.body as AdminCreateInsurerInput, buildRequestContext(req));
      res.status(201).json(toInsurerResponse(result));
    }),
  );

  router.patch(
    "/admin/insurers/:insurerId",
    asyncHandler(async (req, res) => {
      const result = await controller.adminUpdateInsurer(requireActor(), requireParam(req, "insurerId"), req.body as AdminUpdateInsurerInput, buildRequestContext(req));
      res.json(toInsurerResponse(result));
    }),
  );

  router.put(
    "/admin/insurers/:insurerId/status",
    asyncHandler(async (req, res) => {
      const result = await controller.adminSetInsurerStatus(requireActor(), requireParam(req, "insurerId"), req.body as AdminSetInsurerStatusInput, buildRequestContext(req));
      res.json(toInsurerResponse(result));
    }),
  );

  router.post(
    "/admin/insurers/:insurerId/root-account",
    asyncHandler(async (req, res) => {
      const result = await controller.adminCreateOrResetInsurerRootAccount(
        requireActor(),
        requireParam(req, "insurerId"),
        req.body as AdminInsurerRootAccountInput,
        buildRequestContext(req),
      );
      res.json(toInsuranceAccountResponse(result));
    }),
  );

  return router;
}
