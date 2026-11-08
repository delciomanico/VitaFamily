// Controllers HTTP do lado família (openapi.yaml operationIds: listFamilyClinicReceipts, getFamilyClinicReceipt — tag
// "Clinics", M14 R, authorization.md §6.5). O ator é o `User` (`AccessPolicy.can(VIEW_CLINIC_RECEIPTS)`).
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, requireParam } from "../../../platform/http/index.js";
import type { FamilyClinicReceiptView } from "../application/family-receipts.js";
import type { ActorIdentity } from "../application/ports.js";

export interface ClinicReceiptsFamilyController {
  listFamilyClinicReceipts: (actor: ActorIdentity, familyId: string, memberId: string, query: { limit?: string; cursor?: string }) => Promise<{ items: FamilyClinicReceiptView[]; nextCursor: string | null }>;
  getFamilyClinicReceipt: (actor: ActorIdentity, familyId: string, memberId: string, receiptId: string) => Promise<FamilyClinicReceiptView>;
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

export function createClinicReceiptsFamilyRouter(controller: ClinicReceiptsFamilyController): Router {
  const router = Router();
  const base = "/families/:familyId/members/:memberId/clinic-receipts";

  router.get(
    base,
    asyncHandler(async (req, res) => {
      const query: { limit?: string; cursor?: string } = {};
      const limit = queryString(req, "limit");
      const cursor = queryString(req, "cursor");
      if (limit !== undefined) query.limit = limit;
      if (cursor !== undefined) query.cursor = cursor;
      res.json(await controller.listFamilyClinicReceipts(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), query));
    }),
  );

  router.get(
    `${base}/:receiptId`,
    asyncHandler(async (req, res) => {
      res.json(await controller.getFamilyClinicReceipt(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "receiptId")));
    }),
  );

  return router;
}
