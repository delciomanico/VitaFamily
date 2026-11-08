// Controller HTTP de `GET /clinic-portal/audit` (openapi.yaml operationId: listClinicAudit — tag "Clinic Portal", M14 R).
// O ator vem de `platform/actor` (`getClinicActor`, ADR-020): nunca `AccessPolicy`/`User`.
import { Router } from "express";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler } from "../../../platform/http/index.js";
import type { ClinicAuditActor, ClinicAuditPageView, ListClinicAuditQuery } from "../application/list-clinic-audit.js";

export interface ClinicAuditController {
  listClinicAudit: (actor: ClinicAuditActor, query: ListClinicAuditQuery) => Promise<ClinicAuditPageView>;
}

function queryString(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

export function createClinicAuditRouter(controller: ClinicAuditController): Router {
  const router = Router();
  router.get(
    "/clinic-portal/audit",
    asyncHandler(async (req, res) => {
      const actor = getClinicActor();
      if (!actor) {
        throw new UnauthenticatedError({ detail: "Sem sessão válida." });
      }
      const query: ListClinicAuditQuery = {};
      for (const key of ["from", "to", "action", "actorAccountId", "limit", "cursor"] as const) {
        const value = queryString(req, key);
        if (value !== undefined) query[key] = value;
      }
      res.json(await controller.listClinicAudit({ clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, role: actor.role }, query));
    }),
  );
  return router;
}
