// Controller HTTP de leitura da família: `GET /families/{f}/members/{m}/recommendations`
// (openapi.yaml operationId listRecommendations; UC-REC-03). Só leitura — não existe rota para
// escrever (só a clínica cria, BR-CLN-09).
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { ListRecommendationsQuery, RecommendationView } from "../application/list-recommendations.js";
import type { ActorIdentity, CursorPage, RequestContext } from "../application/ports.js";
import { toRecommendationResponse } from "./dto.js";

export interface RecommendationsController {
  listRecommendations: (actor: ActorIdentity, familyId: string, memberId: string, query: ListRecommendationsQuery, context: RequestContext) => Promise<CursorPage<RecommendationView>>;
}

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

export function createRecommendationsRouter(controller: RecommendationsController): Router {
  const router = Router();

  router.get(
    "/families/:familyId/members/:memberId/recommendations",
    asyncHandler(async (req, res) => {
      const query: ListRecommendationsQuery = {};
      for (const name of ["appointmentId", "examinationId", "limit", "cursor"] as const) {
        // O validador OpenAPI converte `limit` (integer) para número antes de chegar aqui.
        const value = req.query[name];
        if (typeof value === "string") {
          query[name] = value;
        } else if (typeof value === "number") {
          query[name] = String(value);
        }
      }
      const page = await controller.listRecommendations(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), query, buildRequestContext(req));
      res.json({ items: page.items.map(toRecommendationResponse), nextCursor: page.nextCursor });
    }),
  );

  return router;
}
