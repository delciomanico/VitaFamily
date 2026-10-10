// Controllers HTTP de `notifications` (openapi.yaml operationIds: getNotificationPreferences,
// putNotificationPreferences, addPushSubscription, deletePushSubscription — tag "Users", mas
// posse dos dados é de `notifications`, modules.md §2). Autenticação/ator já garantidos pelo
// middleware do módulo `auth` (M1).
import { Router } from "express";
import { asyncHandler, requireParam } from "../../../platform/http/index.js";
import { getActor } from "../../../platform/actor/index.js";
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { NotificationPreference, NotificationPreferenceChanges } from "../domain/preference.js";
import type { PushSubscription } from "../domain/push-subscription.js";
import type { NewPushSubscriptionInput } from "../domain/push-subscription.js";
import { toPreferencesResponse, toPushSubscriptionResponse } from "./dto.js";

export interface NotificationsController {
  getPreferences: (userId: string) => Promise<NotificationPreference>;
  putPreferences: (userId: string, changes: NotificationPreferenceChanges) => Promise<NotificationPreference>;
  addPushSubscription: (input: NewPushSubscriptionInput) => Promise<PushSubscription>;
  deletePushSubscription: (userId: string, subscriptionId: string) => Promise<void>;
}

function requireActor(): { userId: string } {
  const actor = getActor();
  if (!actor) {
    throw new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  return actor;
}

export function createNotificationsRouter(controller: NotificationsController): Router {
  const router = Router();

  router.get(
    "/users/me/notification-preferences",
    asyncHandler(async (_req, res) => {
      const actor = requireActor();
      const preference = await controller.getPreferences(actor.userId);
      res.json(toPreferencesResponse(preference));
    }),
  );

  router.put(
    "/users/me/notification-preferences",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const preference = await controller.putPreferences(actor.userId, req.body as NotificationPreferenceChanges);
      res.json(toPreferencesResponse(preference));
    }),
  );

  router.post(
    "/users/me/push-subscriptions",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      const body = req.body as Omit<NewPushSubscriptionInput, "userId">;
      const subscription = await controller.addPushSubscription({ ...body, userId: actor.userId });
      res.status(201).json(toPushSubscriptionResponse(subscription));
    }),
  );

  router.delete(
    "/users/me/push-subscriptions/:subscriptionId",
    asyncHandler(async (req, res) => {
      const actor = requireActor();
      await controller.deletePushSubscription(actor.userId, requireParam(req, "subscriptionId"));
      res.status(204).end();
    }),
  );

  return router;
}
