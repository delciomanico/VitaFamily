// Só para testes: lista os alertas de um destinatário pela mesma vista que a API (texto por tipo).
import { createListAlertsUseCase, type AlertView } from "./list-alerts.js";
import type { AlertsFixtures } from "./fixtures.js";

export async function listAlertsForTest(fx: AlertsFixtures, recipientUserId: string): Promise<AlertView[]> {
  const list = createListAlertsUseCase(fx.deps);
  return (await list(recipientUserId, {})).items;
}
