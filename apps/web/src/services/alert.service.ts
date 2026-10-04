import * as api from '@/mocks/handlers/alerts'

/** Alertas do utilizador. Hoje mock; depois /api/v1/alerts. */
export const alertService = {
  listAlerts: api.listAlerts,
  countUnread: api.countUnread,
  markAlertRead: api.markAlertRead,
  markAllAlertsRead: api.markAllAlertsRead,
}
