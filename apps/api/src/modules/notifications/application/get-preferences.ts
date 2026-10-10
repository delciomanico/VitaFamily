// UC-ALR-05 (leitura): preferências do utilizador autenticado — devolve os defaults (R9) se ainda
// não existir linha própria (nunca cria por uma leitura; `putPreferences` é que persiste).
import { defaultPreference, type NotificationPreference } from "../domain/preference.js";
import type { NotificationsDeps } from "./ports.js";

export function createGetPreferencesUseCase<Trx>(deps: NotificationsDeps<Trx>) {
  return async function getPreferences(userId: string): Promise<NotificationPreference> {
    const existing = await deps.preferencesRepo.findByUserId(deps.db, userId);
    return existing ?? defaultPreference(userId);
  };
}
