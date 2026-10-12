import * as api from '@/mocks/handlers/alerts'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { AlertItem, AlertRuleKey, AlertType } from '@/types/alert'

/** `Alert` (openapi.yaml components.schemas.Alert). */
export interface ApiAlert {
  id: string
  type: 'MEDICATION_DUE' | 'APPOINTMENT_REMINDER' | 'EXAM_REMINDER' | 'APPOINTMENT_OUTCOME_REQUEST'
  familyId: string
  memberId: string
  memberName: string
  message: string
  sourceType: 'DOSE' | 'APPOINTMENT' | 'EXAMINATION'
  sourceId: string
  triggerAt: string
  readAt?: string | null
}

const ALERTS_LIMIT = 50

/** O contrato não expõe a regra que gerou o alerta; usa-se a regra principal de cada tipo. */
const ruleKeyOf: Record<AlertType, AlertRuleKey> = {
  MEDICATION_DUE: 'dose.due',
  APPOINTMENT_REMINDER: 'appointment.24h',
  EXAM_REMINDER: 'exam.24h',
  APPOINTMENT_OUTCOME_REQUEST: 'appointment.outcome',
  APPOINTMENT_CONFIRMED: 'appointment.confirmed',
  APPOINTMENT_REJECTED: 'appointment.rejected',
  APPOINTMENT_CANCELLED: 'appointment.cancelled',
}

export function toAlertItem(alert: ApiAlert): AlertItem {
  return {
    id: alert.id,
    familyId: alert.familyId,
    memberId: alert.memberId,
    memberName: alert.memberName,
    type: alert.type,
    ruleKey: ruleKeyOf[alert.type],
    sourceType: alert.sourceType,
    sourceId: alert.sourceId,
    triggerAt: alert.triggerAt,
    readAt: alert.readAt ?? undefined,
    message: alert.message,
    sourceLabel: '',
    targetId: alert.sourceId,
  }
}

/** `GET /alerts` (API real): só os alertas de que sou destinatário, desta família. */
export async function apiListAlerts(familyId: string, unreadOnly = false): Promise<AlertItem[]> {
  const query = `?limit=${ALERTS_LIMIT}${unreadOnly ? '&unread=true' : ''}`
  const page = await apiFetch<{ items: ApiAlert[] }>(`/alerts${query}`)
  return page.items.filter((a) => a.familyId === familyId).map(toAlertItem)
}

/** Alertas do utilizador (UC-ALR-03/04). Com `VITE_API_URL` usa `/api/v1/alerts`; senão mock. */
export const alertService = hasApiBackend()
  ? {
      listAlerts: (familyId: string, _userId: string) => apiListAlerts(familyId),
      countUnread: async (familyId: string, _userId: string) => (await apiListAlerts(familyId, true)).length,
      markAlertRead: async (_familyId: string, _userId: string, alertId: string) => {
        await apiFetch<void>(`/alerts/${alertId}/read`, { method: 'POST' })
      },
      markAllAlertsRead: async (_familyId: string, _userId: string) => {
        await apiFetch<void>('/alerts/read-all', { method: 'POST' })
      },
    }
  : {
      listAlerts: api.listAlerts,
      countUnread: api.countUnread,
      markAlertRead: api.markAlertRead,
      markAllAlertsRead: api.markAllAlertsRead,
    }
