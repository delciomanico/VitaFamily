import type { FamilyProcess } from '@/types/process'
import { at } from '../time'

/**
 * Processo no mock: `familyId` só no mock (o contrato devolve o membro, não a família). Estado simples do pedido à
 * seguradora já derivado (ADR-036): nunca motivo, valor, serviço nem decisor.
 */
export type MockProcess = FamilyProcess & { familyId: string }

/** Demo: uma aprovação (da Maria, dependente) e um pedido a ser analisado (do titular). */
export function seedProcesses(now: Date = new Date()): MockProcess[] {
  return [
    {
      id: 'prc_aprovado',
      familyId: 'fam_monarca',
      memberId: 'mem_maria',
      kind: 'AUTHORIZED',
      familyStatus: 'IN_PROGRESS',
      nextStep: { code: 'ATTEND', actor: 'FAMILY' },
      coverage: { state: 'APPROVED', appeal: false, partial: false, dueAt: null, validUntil: at(20, '23:59', now) },
      origin: { type: 'AUTHORIZATION', id: 'aut_demo_1' },
      scheduledAt: null,
      openedAt: at(-3, '10:00', now),
    },
    {
      id: 'prc_analise',
      familyId: 'fam_monarca',
      memberId: 'mem_monarca',
      kind: 'AUTHORIZED',
      familyStatus: 'IN_PROGRESS',
      nextStep: { code: 'AWAIT_INSURER_DECISION', actor: 'INSURER', dueAt: at(2, '12:00', now) },
      coverage: { state: 'PENDING', appeal: false, partial: false, dueAt: at(2, '12:00', now), validUntil: null },
      origin: { type: 'AUTHORIZATION', id: 'aut_demo_2' },
      scheduledAt: null,
      openedAt: at(-1, '15:00', now),
    },
  ]
}
