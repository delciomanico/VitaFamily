// `DELETE /users/me/push-subscriptions/{subscriptionId}` (endpoints.md): remover a minha
// subscrição (UC-ALR-06: "o utilizador pode revogá-la"). `delete` já exige `userId` (ownership);
// `NOT_FOUND` quando a subscrição não existe ou não é do utilizador (nunca enumerar).
import { NotFoundError } from "../../../platform/errors/index.js";
import type { NotificationsDeps } from "./ports.js";

export function createDeletePushSubscriptionUseCase<Trx>(deps: NotificationsDeps<Trx>) {
  return async function deletePushSubscription(userId: string, subscriptionId: string): Promise<void> {
    const subscriptions = await deps.pushSubscriptionsRepo.listByUserId(deps.db, userId);
    if (!subscriptions.some((s) => s.id === subscriptionId)) {
      throw new NotFoundError({ detail: "Subscrição não encontrada." });
    }
    await deps.pushSubscriptionsRepo.delete(deps.db, userId, subscriptionId);
  };
}
