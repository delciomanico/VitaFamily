import * as api from '@/mocks/handlers/sharing'

/** Partilha por categoria. Hoje mock; depois /api/v1/families/{id}/members/{id}/sharing e …/shared-with-me. */
export const sharingService = {
  getSharing: api.getSharing,
  putSharing: api.putSharing,
  sharedWithMe: api.sharedWithMe,
}
