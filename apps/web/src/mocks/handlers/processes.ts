import { AppError } from '@/lib/errors'
import type { FamilyProcess } from '@/types/process'
import { memberAccess } from '../access'
import { db } from '../db'
import { respond } from '../respond'

/**
 * Processo do membro, episódio de cuidado (UC-PRC-04). Inexistente, de outro membro/família ou sem acesso
 * ⇒ NOT_FOUND (sem enumeração).
 */
export function getProcess(familyId: string, userId: string, memberId: string, processId: string) {
  return respond((): FamilyProcess => {
    memberAccess(familyId, userId, memberId)
    const found = db.processes.find((p) => p.id === processId && p.familyId === familyId && p.memberId === memberId)
    if (!found) throw new AppError('NOT_FOUND')
    const { familyId: _family, ...process } = found
    return process
  })
}
