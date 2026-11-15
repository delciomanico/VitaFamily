import * as api from '@/mocks/handlers/processes'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { FamilyProcess } from '@/types/process'

/** Processo do membro (`GET /families/{f}/members/{m}/processes/{id}`). Inexistente ou sem acesso ⇒ `NOT_FOUND` (sem enumeração). */
export const processService = hasApiBackend()
  ? {
      getProcess: (familyId: string, _userId: string, memberId: string, processId: string) =>
        apiFetch<FamilyProcess>(`/families/${familyId}/members/${memberId}/processes/${processId}`),
    }
  : { getProcess: api.getProcess }
