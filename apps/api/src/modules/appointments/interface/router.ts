// Controllers HTTP de `appointments` (openapi.yaml operationIds: listAppointments,
// createAppointment, getAppointment, updateAppointment, deleteAppointment,
// setAppointmentStatus — tag "Appointments").
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { CreateAppointmentInput } from "../application/create-appointment.js";
import type { ListAppointmentsQuery } from "../application/list-appointments.js";
import type { ActorIdentity, Appointment, CursorPage, RequestContext } from "../application/ports.js";
import type { SetAppointmentStatusInput } from "../application/set-appointment-status.js";
import type { UpdateAppointmentInput } from "../application/update-appointment.js";
import { toAppointmentPage, toAppointmentResponse } from "./dto.js";

export interface AppointmentsController {
  listAppointments: (actor: ActorIdentity, familyId: string, memberId: string, query: ListAppointmentsQuery, context: RequestContext) => Promise<CursorPage<Appointment>>;
  createAppointment: (actor: ActorIdentity, familyId: string, memberId: string, input: CreateAppointmentInput, context: RequestContext) => Promise<Appointment>;
  getAppointment: (actor: ActorIdentity, familyId: string, memberId: string, appointmentId: string, context: RequestContext) => Promise<Appointment>;
  updateAppointment: (actor: ActorIdentity, familyId: string, memberId: string, appointmentId: string, input: UpdateAppointmentInput, context: RequestContext) => Promise<Appointment>;
  deleteAppointment: (actor: ActorIdentity, familyId: string, memberId: string, appointmentId: string, context: RequestContext) => Promise<void>;
  setAppointmentStatus: (
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    appointmentId: string,
    input: SetAppointmentStatusInput,
    context: RequestContext,
  ) => Promise<Appointment>;
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

export function createAppointmentsRouter(controller: AppointmentsController): Router {
  const router = Router();

  router.get(
    "/families/:familyId/members/:memberId/appointments",
    asyncHandler(async (req, res) => {
      const query: ListAppointmentsQuery = {};
      for (const name of ["status", "from", "to", "limit", "cursor"] as const) {
        const value = queryString(req, name);
        if (value !== undefined) {
          query[name] = value;
        }
      }
      const result = await controller.listAppointments(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), query, buildRequestContext(req));
      res.json(toAppointmentPage(result));
    }),
  );

  router.post(
    "/families/:familyId/members/:memberId/appointments",
    asyncHandler(async (req, res) => {
      const result = await controller.createAppointment(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        req.body as CreateAppointmentInput,
        buildRequestContext(req),
      );
      res.status(201).json(toAppointmentResponse(result));
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/appointments/:appointmentId",
    asyncHandler(async (req, res) => {
      const result = await controller.getAppointment(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "appointmentId"),
        buildRequestContext(req),
      );
      res.json(toAppointmentResponse(result));
    }),
  );

  router.patch(
    "/families/:familyId/members/:memberId/appointments/:appointmentId",
    asyncHandler(async (req, res) => {
      const result = await controller.updateAppointment(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "appointmentId"),
        req.body as UpdateAppointmentInput,
        buildRequestContext(req),
      );
      res.json(toAppointmentResponse(result));
    }),
  );

  router.delete(
    "/families/:familyId/members/:memberId/appointments/:appointmentId",
    asyncHandler(async (req, res) => {
      await controller.deleteAppointment(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "appointmentId"), buildRequestContext(req));
      res.status(204).end();
    }),
  );

  router.put(
    "/families/:familyId/members/:memberId/appointments/:appointmentId/status",
    asyncHandler(async (req, res) => {
      const result = await controller.setAppointmentStatus(
        requireActor(),
        requireParam(req, "familyId"),
        requireParam(req, "memberId"),
        requireParam(req, "appointmentId"),
        req.body as SetAppointmentStatusInput,
        buildRequestContext(req),
      );
      res.json(toAppointmentResponse(result));
    }),
  );

  return router;
}
