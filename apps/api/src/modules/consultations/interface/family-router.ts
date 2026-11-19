// Controllers HTTP do lado da FAMÍLIA (tag «Bookings»; UC-MKT-27..29) e da consulta pública de horários (tag «Marketplace»; UC-MKT-26).
// Autorização na `application` (`BOOK_PROFESSIONALS`). Respostas `no-store`; este router nunca regista corpo nem query.
import { Router, type Request } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import { BOOKING_STATUSES, type BookingStatus } from "../domain/booking.js";
import type { FamilyBookings } from "../application/family-bookings.js";
import { body, optionalString, queryInt, queryString, requireActor } from "./http-helpers.js";

const BASE = "/families/:familyId/members/:memberId/bookings";

function queryDate(req: Request, name: string): Date | undefined {
  const value = queryString(req, name);
  return value === undefined ? undefined : new Date(value);
}

export function createFamilyBookingsRouter(useCases: FamilyBookings): Router {
  const router = Router();
  const ids = (req: Request) => ({ familyId: requireParam(req, "familyId"), memberId: requireParam(req, "memberId") });

  router.get(
    "/marketplace/professionals/:professionalId/slots",
    asyncHandler(async (req, res) => {
      const from = queryDate(req, "from");
      const to = queryDate(req, "to");
      const slots = await useCases.listBookableSlots(requireActor(), requireParam(req, "professionalId"), {
        offerId: queryString(req, "offerId") ?? "",
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      });
      res.set("Cache-Control", "no-store").json(slots);
    }),
  );

  router.get(
    BASE,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const status = queryString(req, "status");
      const limit = queryInt(req, "limit");
      const cursor = queryString(req, "cursor");
      const page = await useCases.listBookings(requireActor(), familyId, memberId, {
        ...(status && (BOOKING_STATUSES as readonly string[]).includes(status) ? { status: status as BookingStatus } : {}),
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
      const clientRequestId = optionalString(b.clientRequestId);
      const result = await useCases.createBooking(
        requireActor(),
        familyId,
        memberId,
        { offerId: String(b.offerId), slotId: String(b.slotId), participantLabel: String(b.participantLabel), ...(clientRequestId !== undefined ? { clientRequestId } : {}) },
        buildRequestContext(req),
      );
      res.set("Cache-Control", "no-store").status(result.created ? 201 : 200).json(result.booking);
    }),
  );

  router.get(
    `${BASE}/:bookingId`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      res.set("Cache-Control", "no-store").json(await useCases.getBooking(requireActor(), familyId, memberId, requireParam(req, "bookingId")));
    }),
  );

  router.post(
    `${BASE}/:bookingId/cancel`,
    asyncHandler(async (req, res) => {
      const { familyId, memberId } = ids(req);
      const note = optionalString(body(req).note);
      res
        .set("Cache-Control", "no-store")
        .json(await useCases.cancelBooking(requireActor(), familyId, memberId, requireParam(req, "bookingId"), { ...(note !== undefined ? { note } : {}) }, buildRequestContext(req)));
    }),
  );

  return router;
}
