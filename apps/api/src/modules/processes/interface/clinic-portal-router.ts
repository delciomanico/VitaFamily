// Controller HTTP do portal da clínica: `GET /clinic-portal/processes/{processId}` (openapi.yaml operationId
// getClinicProcess; UC-PRC-05, BR-PRC-06). O ator é o da clínica (`ClinicActorInfo`, ADR-020), nunca o de `User`.
import { Router } from "express";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, requireParam } from "../../../platform/http/index.js";
import type { ClinicPortalActor } from "../application/ports.js";
import type { ClinicProcessView } from "../application/process-view.js";
import { toClinicProcessResponse } from "./dto.js";

export interface ProcessesClinicPortalController {
  getClinicProcess: (actor: ClinicPortalActor, processId: string) => Promise<ClinicProcessView>;
}

function requireClinicPortalActor(): ClinicPortalActor {
  const actor = getClinicActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, role: actor.role };
}

export function createProcessesClinicPortalRouter(controller: ProcessesClinicPortalController): Router {
  const router = Router();
  router.get(
    "/clinic-portal/processes/:processId",
    asyncHandler(async (req, res) => {
      res.json(toClinicProcessResponse(await controller.getClinicProcess(requireClinicPortalActor(), requireParam(req, "processId"))));
    }),
  );
  return router;
}
