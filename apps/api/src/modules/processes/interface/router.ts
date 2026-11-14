// Controller HTTP da família: `GET /families/{f}/members/{m}/processes` e `…/processes/{processId}`
// (openapi.yaml operationIds listProcesses, getProcess; UC-PRC-03/04). Só leitura: não existem rotas de escrita (BR-PRC-02).
import { Router } from "express";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam } from "../../../platform/http/index.js";
import type { Page } from "../../../platform/page/index.js";
import type { ListProcessesQuery } from "../application/list-processes.js";
import type { ActorIdentity, RequestContext } from "../application/ports.js";
import type { ProcessView } from "../application/process-view.js";
import { toProcessPageResponse, toProcessResponse } from "./dto.js";

export interface ProcessesController {
  listProcesses: (actor: ActorIdentity, familyId: string, memberId: string, query: ListProcessesQuery, context: RequestContext) => Promise<Page<ProcessView>>;
  getProcess: (actor: ActorIdentity, familyId: string, memberId: string, processId: string, context: RequestContext) => Promise<ProcessView>;
}

function requireActor(): ActorIdentity {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { userId: actor.userId, platformAdmin: actor.platformAdmin };
}

export function createProcessesRouter(controller: ProcessesController): Router {
  const router = Router();

  router.get(
    "/families/:familyId/members/:memberId/processes",
    asyncHandler(async (req, res) => {
      const query: ListProcessesQuery = {};
      for (const name of ["status", "originType", "limit", "cursor"] as const) {
        // O validador OpenAPI converte `limit` (integer) para número antes de chegar aqui.
        const value = req.query[name];
        if (typeof value === "string") {
          query[name] = value;
        } else if (typeof value === "number") {
          query[name] = String(value);
        }
      }
      const page = await controller.listProcesses(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), query, buildRequestContext(req));
      res.json(toProcessPageResponse(page));
    }),
  );

  router.get(
    "/families/:familyId/members/:memberId/processes/:processId",
    asyncHandler(async (req, res) => {
      const view = await controller.getProcess(requireActor(), requireParam(req, "familyId"), requireParam(req, "memberId"), requireParam(req, "processId"), buildRequestContext(req));
      res.json(toProcessResponse(view));
    }),
  );

  return router;
}
