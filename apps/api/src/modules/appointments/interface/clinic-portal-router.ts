// Controllers HTTP de `/clinic-portal/requests/*` e `/clinic-portal/agenda/*` (openapi.yaml
// operationIds: listClinicRequests, respondClinicRequest, listClinicAgenda,
// cancelClinicAppointment — tag "Clinic Portal", D17).
//
// Decisão de onde este router vive (Fase D, prompt): dentro de `appointments/interface`, NUNCA em
// `clinics` — a direção de dependência fixada em `modules.md` §2/`tests/architecture-rules.ts` é
// `appointments -> clinics`, nunca o inverso; pôr aqui um router que chama
// `application/clinic-appointments.ts` mantém essa direção (`clinics` continua sem saber nada de
// `Appointment`). O ator (`ClinicActorInfo`) vem de `platform/actor` (`getClinicActor`) — a mesma
// peça de infraestrutura partilhada que `clinics/interface/clinic-portal-router.ts` usa, importada
// diretamente daqui (plataforma, não módulo) — sem nenhuma aresta nova no grafo de módulos.
// `main/api.ts` monta este router a seguir ao de `clinics` (mesmo middleware
// `clinicActorContextMiddleware`, já composto por `clinics`, cobre as duas árvores de rotas).
import { Router } from "express";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError, ValidationError } from "../../../platform/errors/index.js";
import type {
  ClinicAppointmentView,
  ClinicRequestDecision,
  RespondClinicRequestInput,
  CancelClinicAppointmentInput,
  CompleteConsultationInput,
  ListClinicAgendaQuery,
} from "../application/clinic-appointments.js";
import type { ClinicPatientLookupResult, CreateWalkInAppointmentInput } from "../application/clinic-walk-in.js";
import type { ClinicPortalActor, ClinicPrescriptionInput } from "../application/ports.js";
import { toClinicAppointmentListResponse, toClinicAppointmentResponse } from "./dto.js";

export interface AppointmentsClinicPortalController {
  listClinicRequests: (actor: ClinicPortalActor) => Promise<ClinicAppointmentView[]>;
  respondClinicRequest: (actor: ClinicPortalActor, appointmentId: string, input: RespondClinicRequestInput, context: RequestContext) => Promise<ClinicAppointmentView>;
  listClinicAgenda: (actor: ClinicPortalActor, query: ListClinicAgendaQuery) => Promise<ClinicAppointmentView[]>;
  cancelClinicAppointment: (actor: ClinicPortalActor, appointmentId: string, input: CancelClinicAppointmentInput, context: RequestContext) => Promise<ClinicAppointmentView>;
  completeClinicAppointment: (actor: ClinicPortalActor, appointmentId: string, input: CompleteConsultationInput, context: RequestContext) => Promise<ClinicAppointmentView>;
  /** D20 (ADR-024, BR-CLN-10). */
  clinicPatientLookup: (actor: ClinicPortalActor, input: { email: unknown }, context: RequestContext) => Promise<ClinicPatientLookupResult>;
  createClinicWalkInAppointment: (actor: ClinicPortalActor, input: CreateWalkInAppointmentInput, context: RequestContext) => Promise<ClinicAppointmentView>;
}

function requireClinicPortalActor(): ClinicPortalActor {
  const actor = getClinicActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId };
}

function queryString(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

function parseDateQuery(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError([{ field, message: "data/hora inválida" }], { detail: "Filtro de período inválido." });
  }
  return date;
}

function parseDecision(value: unknown): ClinicRequestDecision {
  if (value === "CONFIRM" || value === "REJECT") {
    return value;
  }
  throw new ValidationError([{ field: "decision", message: "tem de ser CONFIRM ou REJECT" }], { detail: "Decisão inválida." });
}

export function createAppointmentsClinicPortalRouter(controller: AppointmentsClinicPortalController): Router {
  const router = Router();

  router.get(
    "/clinic-portal/requests",
    asyncHandler(async (_req, res) => {
      const result = await controller.listClinicRequests(requireClinicPortalActor());
      res.json(toClinicAppointmentListResponse(result));
    }),
  );

  router.put(
    "/clinic-portal/requests/:appointmentId",
    asyncHandler(async (req, res) => {
      const body = req.body as { decision?: unknown; note?: string | null };
      const input: RespondClinicRequestInput = { decision: parseDecision(body.decision), note: body.note ?? null };
      const result = await controller.respondClinicRequest(requireClinicPortalActor(), requireParam(req, "appointmentId"), input, buildRequestContext(req));
      res.json(toClinicAppointmentResponse(result));
    }),
  );

  router.get(
    "/clinic-portal/agenda",
    asyncHandler(async (req, res) => {
      const query: ListClinicAgendaQuery = {};
      const from = parseDateQuery(queryString(req, "from"), "from");
      const to = parseDateQuery(queryString(req, "to"), "to");
      if (from) query.from = from;
      if (to) query.to = to;
      const result = await controller.listClinicAgenda(requireClinicPortalActor(), query);
      res.json(toClinicAppointmentListResponse(result));
    }),
  );

  router.put(
    "/clinic-portal/agenda/:appointmentId/cancel",
    asyncHandler(async (req, res) => {
      const result = await controller.cancelClinicAppointment(
        requireClinicPortalActor(),
        requireParam(req, "appointmentId"),
        req.body as CancelClinicAppointmentInput,
        buildRequestContext(req),
      );
      res.json(toClinicAppointmentResponse(result));
    }),
  );

  router.put(
    "/clinic-portal/agenda/:appointmentId/complete",
    asyncHandler(async (req, res) => {
      const body = req.body as { outcomeNote?: string | null; prescription?: ClinicPrescriptionInput | null };
      const input: CompleteConsultationInput = {
        outcomeNote: body.outcomeNote ?? null,
        prescription: body.prescription ?? null,
      };
      const result = await controller.completeClinicAppointment(requireClinicPortalActor(), requireParam(req, "appointmentId"), input, buildRequestContext(req));
      res.json(toClinicAppointmentResponse(result));
    }),
  );

  router.post(
    "/clinic-portal/patient-lookup",
    asyncHandler(async (req, res) => {
      const body = req.body as { email?: unknown };
      const result = await controller.clinicPatientLookup(requireClinicPortalActor(), { email: body.email }, buildRequestContext(req));
      res.json({ displayName: result.displayName });
    }),
  );

  router.post(
    "/clinic-portal/walk-in-appointments",
    asyncHandler(async (req, res) => {
      const body = req.body as { patientEmail?: unknown; clinicPatientId?: unknown; slotId?: unknown; notes?: string | null };
      const input: CreateWalkInAppointmentInput = {
        patientEmail: body.patientEmail,
        clinicPatientId: body.clinicPatientId,
        slotId: typeof body.slotId === "string" ? body.slotId : "",
        notes: body.notes ?? null,
      };
      const result = await controller.createClinicWalkInAppointment(requireClinicPortalActor(), input, buildRequestContext(req));
      res.status(201).json(toClinicAppointmentResponse(result));
    }),
  );

  return router;
}
