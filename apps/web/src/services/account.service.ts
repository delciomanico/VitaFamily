import * as api from '@/mocks/handlers/account'
import { apiFetch, apiFetchBlob, hasApiBackend } from '@/lib/apiClient'
import type {
  ChangePasswordInput,
  DataExport,
  NotificationPreferences,
  UpdateAccountInput,
} from '@/types/settings'
import type { User } from '@/types/user'
import { toUser, type MeResponse } from './auth.service'

const EXPORT_IDS_KEY = 'vita.exportIds'

/**
 * O contrato não tem listagem de exportações (só pedir e consultar por id): guardam-se
 * localmente os ids pedidos neste dispositivo e consulta-se o estado de cada um.
 */
function knownExportIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(EXPORT_IDS_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

function rememberExportIds(ids: string[]) {
  try {
    localStorage.setItem(EXPORT_IDS_KEY, JSON.stringify(ids.slice(0, 10)))
  } catch {
    // Armazenamento indisponível: a lista só dura até recarregar.
  }
}

async function apiListMyExports(): Promise<DataExport[]> {
  const ids = knownExportIds()
  const found = await Promise.all(ids.map((id) => apiFetch<DataExport>(`/users/me/exports/${id}`).catch(() => null)))
  const items = found.filter((e): e is DataExport => e !== null)
  rememberExportIds(items.map((e) => e.id))
  return items.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt))
}

async function apiRequestMyExport(): Promise<DataExport> {
  const created = await apiFetch<DataExport>('/users/me/exports', { method: 'POST' })
  rememberExportIds([created.id, ...knownExportIds()])
  return created
}

/** A minha conta (UC-ACC-04/05/06). Com `VITE_API_URL` usa `/users/me/*` e `/auth/password/change`. */
export const accountService = hasApiBackend()
  ? {
      updateMe: async (_userId: string, input: UpdateAccountInput): Promise<User> =>
        toUser(await apiFetch<MeResponse>('/users/me', { method: 'PATCH', body: input })),
      changePassword: (_userId: string, input: ChangePasswordInput) =>
        apiFetch<void>('/auth/password/change', { method: 'POST', body: input }),
      deleteMe: (_userId: string, password: string) =>
        apiFetch<void>('/users/me', { method: 'DELETE', body: { password } }),
      getNotificationPreferences: (_userId: string) =>
        apiFetch<NotificationPreferences>('/users/me/notification-preferences'),
      putNotificationPreferences: (_userId: string, input: NotificationPreferences) =>
        apiFetch<NotificationPreferences>('/users/me/notification-preferences', { method: 'PUT', body: input }),
      listMyExports: (_userId: string) => apiListMyExports(),
      requestMyExport: (_userId: string) => apiRequestMyExport(),
      downloadMyExport: (_userId: string, exportId: string): Promise<unknown> =>
        apiFetchBlob(`/users/me/exports/${exportId}/download`),
    }
  : {
      updateMe: api.updateMe,
      changePassword: api.changePassword,
      deleteMe: api.deleteMe,
      getNotificationPreferences: api.getNotificationPreferences,
      putNotificationPreferences: api.putNotificationPreferences,
      listMyExports: api.listMyExports,
      requestMyExport: api.requestMyExport,
      downloadMyExport: api.downloadMyExport,
    }
