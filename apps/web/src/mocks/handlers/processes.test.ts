import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { resetDb } from '../db'
import * as processes from './processes'

const NOW = new Date(2026, 10, 15, 12, 0)
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

beforeEach(() => resetDb(NOW))

describe('processo da família (episódio de cuidado)', () => {
  it('devolve o estado simples e o passo seguinte, sem motivo, valor, serviço, decisor nem família', async () => {
    const process = await processes.getProcess(FAMILY, MONARCA, 'mem_monarca', 'prc_consulta')
    expect(process).toMatchObject({ familyStatus: 'SCHEDULED', nextStep: { code: 'ATTEND', actor: 'FAMILY' } })
    expect(JSON.stringify(process)).not.toMatch(/coverage|decisionNote|internalNote|serviceId|decidedBy|familyId/)
  })

  it('inexistente, de outro membro ou de outra família => NOT_FOUND igual (sem enumeração)', async () => {
    expect(await code(processes.getProcess(FAMILY, MONARCA, 'mem_monarca', 'prc_nao_existe'))).toBe('NOT_FOUND')
    expect(await code(processes.getProcess(FAMILY, MONARCA, 'mem_maria', 'prc_consulta'))).toBe('NOT_FOUND')
    expect(await code(processes.getProcess('fam_outra', MONARCA, 'mem_monarca', 'prc_consulta'))).toBe('NOT_FOUND')
  })
})
