import type { FamilyProcess } from '@/types/process'
import { at } from '../time'

/**
 * Processo (episódio de cuidado) no mock: `familyId` só no mock (o contrato devolve o membro, não a família).
 * Nunca motivo, valor, serviço nem decisor.
 */
export type MockProcess = FamilyProcess & { familyId: string }

/** Demo: um processo aberto por uma consulta marcada. */
export function seedProcesses(now: Date = new Date()): MockProcess[] {
  return [
    {
      id: 'prc_consulta',
      familyId: 'fam_monarca',
      memberId: 'mem_monarca',
      kind: 'CONSULTATION',
      familyStatus: 'SCHEDULED',
      nextStep: { code: 'ATTEND', actor: 'FAMILY' },
      origin: { type: 'APPOINTMENT', id: 'apt_cardio' },
      scheduledAt: at(1, '09:30', now),
      openedAt: at(-1, '15:00', now),
    },
  ]
}
