// UC-ALR-06: registar subscrição Web Push; "endpoint repetido atualiza a existente" (endpoints.md
// `addPushSubscription`) — `endpoint` é `UNIQUE` (schema.md §1), por isso `upsert`.
import { newId } from "../../../platform/ids/index.js";
import type { NewPushSubscriptionInput, PushSubscription } from "../domain/push-subscription.js";
import type { NotificationsDeps } from "./ports.js";

export function createAddPushSubscriptionUseCase<Trx>(deps: NotificationsDeps<Trx>) {
  return async function addPushSubscription(input: NewPushSubscriptionInput): Promise<PushSubscription> {
    return deps.pushSubscriptionsRepo.upsert(deps.db, input, newId(), deps.clock.now());
  };
}
