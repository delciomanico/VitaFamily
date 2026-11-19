// Controllers HTTP da moderação do admin (tag «Admin»; UC-MKT-24). O guard `PLATFORM_ADMIN` está nos casos de uso. As respostas levam
// texto de mensagens (a denunciada e o contexto): `no-store` e nunca registadas (BR-MKT-46).
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { Moderation } from "../application/moderation.js";
import type { ActorIdentity } from "../application/ports.js";
import { body, queryInt, queryString } from "./http-helpers.js";

function requireAdmin(): ActorIdentity {
  const actor = getActor();
  if (!actor) throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

export function createAdminModerationRouter(useCases: Moderation): Router {
  const router = Router();

  router.get(
    "/admin/message-reports",
    asyncHandler(async (req, res) => {
      const status = queryString(req, "status");
      const limit = queryInt(req, "limit");
      const cursor = queryString(req, "cursor");
      const page = await useCases.listReports(requireAdmin(), {
        ...(status === "OPEN" || status === "DECIDED" ? { status } : {}),
        ...(limit !== undefined ? { limit } : {}),
        ...(cursor !== undefined ? { cursor } : {}),
      });
      res.set("Cache-Control", "no-store").json(page);
    }),
  );

  router.get(
    "/admin/message-reports/:reportId",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.getReport(requireAdmin(), requireParam(req, "reportId"), buildRequestContext(req)));
    }),
  );

  router.post(
    "/admin/message-reports/:reportId/decisions",
    asyncHandler(async (req, res) => {
      res.set("Cache-Control", "no-store").json(await useCases.decide(requireAdmin(), requireParam(req, "reportId"), { decision: String(body(req).decision) }, buildRequestContext(req)));
    }),
  );

  return router;
}
