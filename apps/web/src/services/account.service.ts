import * as api from '@/mocks/handlers/account'

/** A minha conta. Hoje mock; depois /api/v1/users/me/* e /api/v1/auth/password/change. */
export const accountService = {
  updateMe: api.updateMe,
  changePassword: api.changePassword,
  deleteMe: api.deleteMe,
  getNotificationPreferences: api.getNotificationPreferences,
  putNotificationPreferences: api.putNotificationPreferences,
  listMyExports: api.listMyExports,
  requestMyExport: api.requestMyExport,
  downloadMyExport: api.downloadMyExport,
}
