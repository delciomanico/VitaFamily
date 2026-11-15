import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as alerts from './alerts'
import * as processes from './processes'

const NOW = new Date(2026, 10, 15, 12, 0)
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
const ANA = 'usr_ana'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

beforeEach(() => resetDb(NOW))

describe('processo da família (ADR-036)', () => {
  it('o titular/tutor vê o estado simples do pedido; a resposta não traz motivo, valor, serviço nem decisor', async () => {
    const process = await processes.getProcess(FAMILY, MONARCA, 'mem_maria', 'prc_aprovado')
    expect(process).toMatchObject({ familyStatus: 'IN_PROGRESS', nextStep: { code: 'ATTEND', actor: 'FAMILY' }, coverage: { state: 'APPROVED', appeal: false, partial: false } })
    expect(JSON.stringify(process)).not.toMatch(/decisionNote|internalNote|authorizedAmount|requestedAmount|serviceId|justification|decidedBy|familyId/)
  })

  it('inexistente, de outro membro ou de outra família => NOT_FOUND igual (sem enumeração)', async () => {
    expect(await code(processes.getProcess(FAMILY, MONARCA, 'mem_maria', 'prc_nao_existe'))).toBe('NOT_FOUND')
    expect(await code(processes.getProcess(FAMILY, MONARCA, 'mem_monarca', 'prc_aprovado'))).toBe('NOT_FOUND')
    expect(await code(processes.getProcess('fam_outra', MONARCA, 'mem_maria', 'prc_aprovado'))).toBe('NOT_FOUND')
  })

  it('quem não gere o membro (Ana) não lê o processo aberto por um pedido: NOT_FOUND', async () => {
    expect(await code(processes.getProcess(FAMILY, ANA, 'mem_monarca', 'prc_analise'))).toBe('NOT_FOUND')
  })

  it('alertas do pedido: só o titular adulto e os tutores (nunca o dependente), sourceType PROCESS, idempotentes', () => {
    const created = processes.raiseAuthorizationAlert(db, 'APPROVED', 'prc_aprovado', NOW)
    expect(created.map((a) => a.recipientUserId)).toEqual([MONARCA]) // tutor da Maria
    expect(created[0]).toMatchObject({ type: 'AUTHORIZATION_APPROVED', ruleKey: 'authorization.approved', sourceType: 'PROCESS', sourceId: 'prc_aprovado', memberId: 'mem_maria' })
    expect(processes.raiseAuthorizationAlert(db, 'APPROVED', 'prc_aprovado', NOW)).toEqual([])
    expect(processes.raiseAuthorizationAlert(db, 'WITHDRAWN', 'prc_aprovado', new Date(NOW.getTime() + 1000))).toHaveLength(1)
    expect(processes.raiseAuthorizationAlert(db, 'EXPIRING', 'prc_nao_existe', NOW)).toEqual([])
  })

  it('o alerta aparece no centro de alertas com o processo como destino e texto fixo', async () => {
    processes.raiseAuthorizationAlert(db, 'NOT_APPROVED', 'prc_aprovado', new Date(NOW.getTime() - 60_000))
    const item = (await alerts.listAlerts(FAMILY, MONARCA, NOW)).find((a) => a.type === 'AUTHORIZATION_NOT_APPROVED')
    expect(item).toMatchObject({ sourceType: 'PROCESS', targetId: 'prc_aprovado', memberName: 'Maria Lopes' })
  })
})
