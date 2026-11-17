// Controllers HTTP de `/professional-portal/offers*` (UC-MKT-08). O profissional é sempre o do token.
import { Router } from "express";
import { ValidationError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import type { OfferRecord } from "../application/ports.js";
import type { ProfessionalActor } from "../application/profile.js";
import { requireProfessionalActor } from "./profile-router.js";

export interface OffersController {
  listOffers: (actor: ProfessionalActor, query: { active?: boolean }) => Promise<OfferRecord[]>;
  createOffer: (actor: ProfessionalActor, input: Record<string, unknown>, ctx: RequestContext) => Promise<OfferRecord>;
  updateOffer: (actor: ProfessionalActor, offerId: string, input: Record<string, unknown>, ctx: RequestContext) => Promise<OfferRecord>;
}

export function toOfferResponse(o: OfferRecord) {
  return { id: o.id, specialtyId: o.specialtyId, method: o.method, durationMinutes: o.durationMinutes, priceKz: o.priceKz, note: o.note, active: o.active };
}

export function booleanQuery(value: unknown, name: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw new ValidationError([{ field: name, message: "true ou false" }], { detail: "Filtro inválido." });
}

export function createOffersRouter(controller: OffersController): Router {
  const router = Router();
  router.get(
    "/professional-portal/offers",
    asyncHandler(async (req, res) => {
      const active = booleanQuery(req.query.active, "active");
      const offers = await controller.listOffers(requireProfessionalActor(), active === undefined ? {} : { active });
      res.set("Cache-Control", "no-store").json(offers.map(toOfferResponse));
    }),
  );
  router.post(
    "/professional-portal/offers",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").status(201).json(toOfferResponse(await controller.createOffer(requireProfessionalActor(), req.body as Record<string, unknown>, buildRequestContext(req))));
    }),
  );
  router.patch(
    "/professional-portal/offers/:offerId",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(toOfferResponse(await controller.updateOffer(requireProfessionalActor(), requireParam(req, "offerId"), req.body as Record<string, unknown>, buildRequestContext(req))));
    }),
  );
  return router;
}
