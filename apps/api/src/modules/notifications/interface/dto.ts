// Mapeamento das vistas da application -> forma da API (openapi.yaml: NotificationPreferences,
// PushSubscription).
import type { NotificationPreference } from "../domain/preference.js";
import type { PushSubscription } from "../domain/push-subscription.js";

export function toPreferencesResponse(preference: NotificationPreference) {
  return {
    pushEnabled: preference.pushEnabled,
    emailEnabled: preference.emailEnabled,
    medicationDue: preference.medicationDue,
    appointmentReminder: preference.appointmentReminder,
    examReminder: preference.examReminder,
  };
}

export function toPushSubscriptionResponse(subscription: PushSubscription) {
  return {
    id: subscription.id,
    endpoint: subscription.endpoint,
    createdAt: subscription.createdAt.toISOString(),
  };
}
