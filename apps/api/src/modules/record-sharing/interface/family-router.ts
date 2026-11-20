// Controllers HTTP do lado da FAMÍLIA (tag «Record Sharing»; UC-MKT-48..52). Autorização na `application` (`SHARE_WITH_PROFESSIONALS`).
// Respostas `no-store`; este router nunca regista corpo nem query (BR-MKT-75).
import { Router, type Request } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { FamilyShares } from "../application/family-shares.js";
import { body, queryInt, queryString, requireActor } from "./http-helpers.js";

const BASE = "/families/:familyId/members/:memberId/record-shares";

export function createFamilySharesRouter(useCases: FamilyShares): Router {
  const router = Router();
  const ids = (req: Request) => ({ familyId: requireParam(req, "familyId"), memberId: requireParam(req, "memberId") });

  // `/options` antes de `/:shareId`.
  router.get(
    `${BASE}/options`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      res.set("Cache-Control", "no-store").json(await useCases.getOptions(requireActor(), familyId, memberId, queryString(req, "bookingId") ?? ""));
    }),
  );

  router.get(
    BASE,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const bookingId = queryString(req, "bookingId");
      const status = queryString(req, "status");
      const limit = queryInt(req, "limit");
      const cursor = queryString(req, "cursor");
      const page = await useCases.listShares(requireActor(), familyId, memberId, {
        ...(bookingId !== undefined ? { bookingId } : {}),
        ...(status !== undefined ? { status } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      res.set("Cache-Control", "no-store").json(page);
    }),
  );

  router.post(
    BASE,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const b = body(req);
      const result = await useCases.createShare(
        requireActor(),
        familyId,
        memberId,
        {
          bookingId: String(b.bookingId),
          categories: Array.isArray(b.categories) ? b.categories.map(String) : [],
          validity: String(b.validity),
          ...(typeof b.viewOnce === "boolean" ? { viewOnce: b.viewOnce } : {}),
          ...(typeof b.clientRequestId === "string" ? { clientRequestId: b.clientRequestId } : {}),
        },
        buildRequestContext(req),
      );
      res.set("Cache-Control", "no-store").status(result.created ? 201 : 200).json(result.share);
    }),
  );

  router.get(
    `${BASE}/:shareId`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      res.set("Cache-Control", "no-store").json(await useCases.getShare(requireActor(), familyId, memberId, requireParam(req, "shareId")));
    }),
  );

  router.post(
    `${BASE}/:shareId/revoke`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      res.set("Cache-Control", "no-store").json(await useCases.revokeShare(requireActor(), familyId, memberId, requireParam(req, "shareId"), buildRequestContext(req)));
    }),
  );

  router.get(
    `${BASE}/:shareId/views`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const limit = queryInt(req, "limit");
      const cursor = queryString(req, "cursor");
      const page = await useCases.listViews(requireActor(), familyId, memberId, requireParam(req, "shareId"), {
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      res.set("Cache-Control", "no-store").json(page);
    }),
  );

  return router;
}
