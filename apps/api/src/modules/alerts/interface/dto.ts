// Mapeamento das vistas da application -> forma da API (openapi.yaml: Alert).
import type { AlertView } from "../application/list-alerts.js";
import type { CursorPage } from "../application/ports.js";

export function toAlertResponse(alert: AlertView) {
  return {
    id: alert.id,
    type: alert.type,
    familyId: alert.familyId,
    memberId: alert.memberId,
    memberName: alert.memberName,
    message: alert.message,
    sourceType: alert.sourceType,
    sourceId: alert.sourceId,
    triggerAt: alert.triggerAt.toISOString(),
    readAt: alert.readAt ? alert.readAt.toISOString() : null,
  };
}

export function toAlertPage(page: CursorPage<AlertView>) {
  return { items: page.items.map(toAlertResponse), nextCursor: page.nextCursor };
}
