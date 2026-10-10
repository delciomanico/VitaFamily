// UC-ALR-05: "escolhe canais ativos e tipos (toma/consulta/exame), por conta" (BR-ALR-04, R9, Q3:
// "os alertas de toma podem ser desativados totalmente"). Sem auditoria (modules.md §2:
// `notifications` não depende de `audit` — preferência de notificação não é dado de saúde nem
// ação estrutural, mesmo critério de `mark-unconfirmed`/`generate-doses`, conventions.md §2).
import { applyPreferenceChanges, defaultPreference, type NotificationPreference, type NotificationPreferenceChanges } from "../domain/preference.js";
import type { NotificationsDeps } from "./ports.js";

export function createPutPreferencesUseCase<Trx>(deps: NotificationsDeps<Trx>) {
  return async function putPreferences(userId: string, changes: NotificationPreferenceChanges): Promise<NotificationPreference> {
    const existing = await deps.preferencesRepo.findByUserId(deps.db, userId);
    const updated = applyPreferenceChanges(existing ?? defaultPreference(userId), changes);
    return deps.preferencesRepo.upsert(deps.db, updated);
  };
}
