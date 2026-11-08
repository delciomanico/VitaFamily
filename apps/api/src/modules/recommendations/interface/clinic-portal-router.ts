// Controllers HTTP de `/clinic-portal/recommendations` (openapi.yaml operationIds:
// listClinicRecommendations, createClinicRecommendation — tag "Clinic Portal", D19/ADR-023).
// Vive em `recommendations/interface` (modules.md §3: o prefixo `/clinic-portal/*` é servido pelos
// routers dos módulos dono). Sem PUT/PATCH/DELETE: a recomendação é imutável (BR-CLN-09). O ator
// (`ClinicActorInfo`) vem de `platform/actor` — token de clínica separado (ADR-020).
import { Router } from "express";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, type RequestContext } from "../../../platform/http/index.js";
import type { ClinicRecommendationView, CreateClinicRecommendationInput, ListClinicRecommendationsQuery } from "../application/clinic-recommendations.js";
import type { ClinicPortalActor } from "../application/ports.js";
import { toClinicRecommendationResponse } from "./dto.js";

export interface RecommendationsClinicPortalController {
  createClinicRecommendation: (actor: ClinicPortalActor, input: CreateClinicRecommendationInput, context: RequestContext) => Promise<ClinicRecommendationView>;
  listClinicRecommendations: (actor: ClinicPortalActor, query: ListClinicRecommendationsQuery) => Promise<ClinicRecommendationView[]>;
}

function requireClinicPortalActor(): ClinicPortalActor {
  const actor = getClinicActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, ...(actor.professionalId ? { professionalId: actor.professionalId } : {}) };
}

function queryString(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

export function createRecommendationsClinicPortalRouter(controller: RecommendationsClinicPortalController): Router {
  const router = Router();

  router.get(
    "/clinic-portal/recommendations",
    asyncHandler(async (req, res) => {
      const query: ListClinicRecommendationsQuery = {};
      const appointmentId = queryString(req, "appointmentId");
      const examinationId = queryString(req, "examinationId");
      if (appointmentId) query.appointmentId = appointmentId;
      if (examinationId) query.examinationId = examinationId;
      res.json((await controller.listClinicRecommendations(requireClinicPortalActor(), query)).map(toClinicRecommendationResponse));
    }),
  );

  router.post(
    "/clinic-portal/recommendations",
    asyncHandler(async (req, res) => {
      const body = req.body as CreateClinicRecommendationInput;
      const input: CreateClinicRecommendationInput = { text: body.text, appointmentId: body.appointmentId ?? null, examinationId: body.examinationId ?? null };
      res.status(201).json(toClinicRecommendationResponse(await controller.createClinicRecommendation(requireClinicPortalActor(), input, buildRequestContext(req))));
    }),
  );

  return router;
}
