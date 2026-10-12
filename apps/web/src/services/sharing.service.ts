import * as api from '@/mocks/handlers/sharing'
import { hasApiBackend } from '@/lib/apiClient'
import type { SharingRule } from '@/types/settings'
import { apiGetSharing, apiPutSharing, apiSharedWithMe } from './memberViews'

/** Partilha por categoria. Com `VITE_API_URL` usa `…/members/{id}/sharing` e `…/shared-with-me`. */
export const sharingService = hasApiBackend()
  ? {
      getSharing: (familyId: string, _userId: string, memberId: string) => apiGetSharing(familyId, memberId),
      putSharing: (familyId: string, _userId: string, memberId: string, grants: SharingRule[]) =>
        apiPutSharing(familyId, memberId, grants),
      sharedWithMe: (familyId: string, _userId: string) => apiSharedWithMe(familyId),
    }
  : {
      getSharing: api.getSharing,
      putSharing: api.putSharing,
      sharedWithMe: api.sharedWithMe,
    }
