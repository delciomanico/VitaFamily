// Controllers HTTP de `/clinic-portal/receipts*` (openapi.yaml operationIds: listClinicReceipts, createClinicReceipt,
// getClinicReceipt, voidClinicReceipt — tag "Clinic Portal", M14 R). O ator vem de `platform/actor` (`getClinicActor`,
// ADR-020): nunca `AccessPolicy`/`User`. A matriz papel × rota (Médico => FORBIDDEN) é do middleware do portal (`clinics`).
import { Router } from "express";
import { getClinicActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { asyncHandler, buildRequestContext, requireParam, type RequestContext } from "../../../platform/http/index.js";
import type { ClinicReceiptPageView, ListReceiptsQuery } from "../application/list-receipts.js";
import type { ClinicPortalActor } from "../application/ports.js";
import type { ClinicReceiptView } from "../application/support.js";

export interface ClinicReceiptsPortalController {
  listClinicReceipts: (actor: ClinicPortalActor, query: ListReceiptsQuery) => Promise<ClinicReceiptPageView>;
  createClinicReceipt: (actor: ClinicPortalActor, body: unknown, context: RequestContext) => Promise<ClinicReceiptView>;
  getClinicReceipt: (actor: ClinicPortalActor, receiptId: string) => Promise<ClinicReceiptView>;
  voidClinicReceipt: (actor: ClinicPortalActor, receiptId: string, body: unknown, context: RequestContext) => Promise<ClinicReceiptView>;
}

function requireClinicPortalActor(): ClinicPortalActor {
  const actor = getClinicActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return { clinicAccountId: actor.clinicAccountId, clinicId: actor.clinicId, role: actor.role };
}

function queryString(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

export function createClinicReceiptsPortalRouter(controller: ClinicReceiptsPortalController): Router {
  const router = Router();

  router.get(
    "/clinic-portal/receipts",
    asyncHandler(async (req, res) => {
      const query: ListReceiptsQuery = { from: queryString(req, "from"), to: queryString(req, "to"), status: queryString(req, "status") };
      const limit = queryString(req, "limit");
      const cursor = queryString(req, "cursor");
      if (limit !== undefined) query.limit = limit;
      if (cursor !== undefined) query.cursor = cursor;
      res.json(await controller.listClinicReceipts(requireClinicPortalActor(), query));
    }),
  );

  router.post(
    "/clinic-portal/receipts",
    asyncHandler(async (req, res) => {
      res.status(201).json(await controller.createClinicReceipt(requireClinicPortalActor(), req.body, buildRequestContext(req)));
    }),
  );

  router.get(
    "/clinic-portal/receipts/:receiptId",
    asyncHandler(async (req, res) => {
      res.json(await controller.getClinicReceipt(requireClinicPortalActor(), requireParam(req, "receiptId")));
    }),
  );

  router.post(
    "/clinic-portal/receipts/:receiptId/void",
    asyncHandler(async (req, res) => {
      res.json(await controller.voidClinicReceipt(requireClinicPortalActor(), requireParam(req, "receiptId"), req.body, buildRequestContext(req)));
    }),
  );

  return router;
}
