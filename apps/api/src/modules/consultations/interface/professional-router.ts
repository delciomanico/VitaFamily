// Controllers HTTP do lado do PROFISSIONAL (tag «Professional Portal»; UC-MKT-30..33). Ator: `ProfessionalAccount` do token
// (`professionalBearerAuth`); a marcação procura-se pelo `professionalId` do token. Privacidade (BR-MKT-63): `no-store`, sem corpo nem
// query em logs; as vistas nunca têm ids de família, membro nem utilizador.
import { Router, type Request } from "express";
import { getProfessionalActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import { BOOKING_STATUSES, type BookingStatus } from "../domain/booking.js";
import type { ProfessionalActor } from "../application/ports.js";
import type { ProfessionalBookings } from "../application/professional-bookings.js";
import { body, optionalString, queryInt, queryString } from "./http-helpers.js";

function requireProfessional(): ProfessionalActor {
  const actor = getProfessionalActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { professionalId: actor.professionalId, professionalAccountId: actor.professionalAccountId };
}

const BASE = "/professional-portal/bookings";

function queryDate(req: Request, name: string): Date | undefined {
  const value = queryString(req, name);
  return value === undefined ? undefined : new Date(value);
}

export function createProfessionalBookingsRouter(useCases: ProfessionalBookings): Router {
  const router = Router();
  const id = (req: Request) => requireParam(req, "bookingId");

  router.get(
    BASE,
    asyncHandler(async (req, res) => {
      const status = queryString(req, "status");
      const limit = queryInt(req, "limit");
      const cursor = queryString(req, "cursor");
      const from = queryDate(req, "from");
      const to = queryDate(req, "to");
      const page = await useCases.listBookings(requireProfessional(), {
        ...(status && (BOOKING_STATUSES as readonly string[]).includes(status) ? { status: status as BookingStatus } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      res.set("Cache-Control", "no-store").json(page);
    }),
  );

  router.get(
    `${BASE}/:bookingId`,
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.getBooking(requireProfessional(), id(req)));
    }),
  );

  router.post(
    `${BASE}/:bookingId/confirm`,
    asyncHandler(async (req, res) => {
      const meetingInfo = optionalString(body(req).meetingInfo);
      res.set("Cache-Control", "no-store").json(await useCases.confirmBooking(requireProfessional(), id(req), { ...(meetingInfo !== undefined ? { meetingInfo } : {}) }, buildRequestContext(req)));
    }),
  );

  router.post(
    `${BASE}/:bookingId/reject`,
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.rejectBooking(requireProfessional(), id(req), { reason: optionalString(body(req).reason) ?? "" }, buildRequestContext(req)));
    }),
  );

  router.post(
    `${BASE}/:bookingId/cancel`,
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.cancelBooking(requireProfessional(), id(req), { reason: optionalString(body(req).reason) ?? "" }, buildRequestContext(req)));
    }),
  );

  router.post(
    `${BASE}/:bookingId/complete`,
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.completeBooking(requireProfessional(), id(req), buildRequestContext(req)));
    }),
  );

  router.post(
    `${BASE}/:bookingId/no-show`,
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.markNoShow(requireProfessional(), id(req), buildRequestContext(req)));
    }),
  );

  return router;
}
