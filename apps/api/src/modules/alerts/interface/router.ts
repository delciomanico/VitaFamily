// Controllers HTTP de `alerts` (openapi.yaml operationIds: listAlerts, markAlertRead,
// markAllAlertsRead — tag "Alerts").
import { Router } from "express";
import { asyncHandler, requireParam } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { AlertView, ListAlertsQuery } from "../application/list-alerts.js";
import type { CursorPage } from "../application/ports.js";
import { toAlertPage } from "./dto.js";

export interface AlertsController {
  listAlerts: (recipientUserId: string, query: ListAlertsQuery) => Promise<CursorPage<AlertView>>;
  markAlertRead: (recipientUserId: string, alertId: string) => Promise<void>;
  markAllAlertsRead: (recipientUserId: string) => Promise<void>;
}

function requireActor(): { userId: string } {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return actor;
}

function queryString(req: { query: Record<string, unknown> }, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === "string" ? value : undefined;
}

export function createAlertsRouter(controller: AlertsController): Router {
  const router = Router();

  router.get(
    "/alerts",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const unread = queryString(req, "unread");
      const limit = queryString(req, "limit");
      const cursor = queryString(req, "cursor");
      const query: ListAlertsQuery = { ...(unread ? { unread } : {}), ...(limit ? { limit } : {}), ...(cursor ? { cursor } : {}) };
      const page = await controller.listAlerts(actor.userId, query);
      res.json(toAlertPage(page));
    }),
  );

  router.post(
    "/alerts/:alertId/read",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      await controller.markAlertRead(actor.userId, requireParam(req, "alertId"));
      res.status(204).end();
    }),
  );

  router.post(
    "/alerts/read-all",
    asyncHandler(async (_req, res) => {
      const actor = requireActor();
      await controller.markAllAlertsRead(actor.userId);
      res.status(204).end();
    }),
  );

  return router;
}
