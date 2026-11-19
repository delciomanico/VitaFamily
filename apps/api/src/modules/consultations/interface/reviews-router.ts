// Controllers HTTP das avaliações (UC-MKT-39..43): família (`Bookings`), consulta pública (`Marketplace`), portal do profissional e admin.
// Respostas `no-store`; este router nunca regista corpo nem query (texto livre é dado sensível, BR-MKT-63).
import { Router, type Request } from "express";
import { getProfessionalActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { ProfessionalActor } from "../application/ports.js";
import type { Reviews } from "../application/reviews.js";
import { body, queryInt, queryString, requireActor } from "./http-helpers.js";

function requireProfessional(): ProfessionalActor {
  const actor = getProfessionalActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { professionalId: actor.professionalId, professionalAccountId: actor.professionalAccountId };
}

const FAMILY_REVIEW = "/families/:familyId/members/:memberId/bookings/:bookingId/review";

const page = (req: Request): { limit?: number; cursor?: string } => {
  const limit = queryInt(req, "limit");
  const cursor = queryString(req, "cursor");
  return { ...(limit !== undefined ? { limit } : {}), ...(cursor !== undefined ? { cursor } : {}) };
};

/** `limit` presente mas não numérico (ex.: `abc`, `-1`) ⇒ valor inválido que a `application` rejeita com 400. */
const strictPage = (req: Request): { limit?: number; cursor?: string } => {
  const parsed = page(req);
  if (req.query.limit !== undefined && parsed.limit === undefined) return { ...parsed, limit: 0 };
  return parsed;
};

export function createReviewsRouters(useCases: Reviews): { familyRouter: Router; professionalRouter: Router; adminRouter: Router } {
  const familyRouter = Router();
  const ids = (req: Request) => ({ familyId: requireParam(req, "familyId"), memberId: requireParam(req, "memberId"), bookingId: requireParam(req, "bookingId") });

  familyRouter.get(
    FAMILY_REVIEW,
    asyncHandler(async (req, res) => {
      const { familyId, memberId, bookingId } = ids(req);
      res.set("Cache-Control", "no-store").json(await useCases.getReview(requireActor(), familyId, memberId, bookingId));
    }),
  );

  familyRouter.put(
    FAMILY_REVIEW,
    asyncHandler(async (req, res) => {
      const { familyId, memberId, bookingId } = ids(req);
      const input = body(req);
      const result = await useCases.putReview(requireActor(), familyId, memberId, bookingId, { rating: input.rating, comment: input.comment }, buildRequestContext(req));
      res.set("Cache-Control", "no-store").status(result.created ? 201 : 200).json(result.review);
    }),
  );

  familyRouter.get(
    "/marketplace/professionals/:professionalId/reviews",
    asyncHandler(async (req, res) => {
      const specialtyId = queryString(req, "specialtyId");
      res.set("Cache-Control", "no-store").json(await useCases.listPublic(requireActor(), requireParam(req, "professionalId"), { ...(specialtyId !== undefined ? { specialtyId } : {}), ...strictPage(req) }));
    }),
  );

  const professionalRouter = Router();
  professionalRouter.get(
    "/professional-portal/reviews",
    asyncHandler(async (req, res) => {
      // O validador do OpenAPI coage `unanswered` para booleano; sem coerção chega a string.
      const raw: unknown = req.query.unanswered;
      const unanswered = raw === true || raw === "true" ? "true" : undefined;
      res.set("Cache-Control", "no-store").json(await useCases.listOwn(requireProfessional(), { ...(unanswered === "true" ? { unanswered: true } : {}), ...strictPage(req) }));
    }),
  );

  professionalRouter.post(
    "/professional-portal/reviews/:reviewId/reply",
    asyncHandler(async (req, res) => {
      const view = await useCases.reply(requireProfessional(), requireParam(req, "reviewId"), { text: body(req).text }, buildRequestContext(req));
      res.set("Cache-Control", "no-store").status(201).json(view);
    }),
  );

  professionalRouter.post(
    "/professional-portal/reviews/:reviewId/reports",
    asyncHandler(async (req, res) => {
      const input = body(req);
      const result = await useCases.report(requireProfessional(), requireParam(req, "reviewId"), { reason: input.reason, note: input.note }, buildRequestContext(req));
      res.set("Cache-Control", "no-store").status(result.created ? 201 : 200).json(result.report);
    }),
  );

  const adminRouter = Router();
  adminRouter.get(
    "/admin/review-reports",
    asyncHandler(async (req, res) => {
      const status = queryString(req, "status");
      res.set("Cache-Control", "no-store").json(await useCases.listReports(requireActor(), { ...(status === "OPEN" || status === "DECIDED" ? { status } : {}), ...strictPage(req) }));
    }),
  );

  adminRouter.get(
    "/admin/review-reports/:reportId",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.getReport(requireActor(), requireParam(req, "reportId"), buildRequestContext(req)));
    }),
  );

  adminRouter.post(
    "/admin/review-reports/:reportId/decisions",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.decideReport(requireActor(), requireParam(req, "reportId"), { decision: body(req).decision }, buildRequestContext(req)));
    }),
  );

  return { familyRouter, professionalRouter, adminRouter };
}
