import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { components } from '../../../api/src/generated/openapi'
import { getFamilyHealthSummary, getMemberHealthSummary } from '@/mocks/handlers/healthSummary'
import { db, resetDb } from '@/mocks/db'
import type { FamilyHealthSummary, HealthSummary } from '@/types/healthSummary'
import { contractErrors } from './openapiSchema'

/*
 * Contrato do Resumo de saúde (M17): o mock e a API real têm de devolver a forma do openapi.
 * - Fixtures `*.api.json`: respostas REAIS da API local (dados sintéticos, GET dos dois endpoints com um
 *   utilizador semeado); recapturar quando o contrato mudar.
 * - Mock: respostas dos handlers, com e sem dados.
 * - Tipos: os tipos escritos à mão em `types/healthSummary.ts` têm de ser atribuíveis ao tipo gerado do openapi
 *   (e vice-versa), por isso o `tsc` falha se divergirem.
 */

const fixture = <T>(name: string) => JSON.parse(readFileSync(join(process.cwd(), 'src/contract/fixtures', name), 'utf8')) as T

// Verificações de tipos (só compilação): web ⇄ gerado.
type Generated = components['schemas']
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const memberTypesAgree: Mutual<HealthSummary, Generated['HealthSummary']> = true
const familyTypesAgree: Mutual<FamilyHealthSummary, Generated['FamilyHealthSummary']> = true

const NOW = new Date(2026, 9, 14, 12, 0)
const FAMILY = 'fam_monarca'
const USER = 'usr_monarca'

beforeEach(() => resetDb(NOW))

describe('tipos do web vs openapi gerado', () => {
  it('coincidem', () => {
    expect(memberTypesAgree && familyTypesAgree).toBe(true)
  })
})

describe('respostas reais da API (fixtures) cumprem o openapi', () => {
  it('HealthSummary', () => {
    expect(contractErrors('HealthSummary', fixture('health-summary.member.api.json'))).toEqual([])
  })
  it('FamilyHealthSummary', () => {
    expect(contractErrors('FamilyHealthSummary', fixture('health-summary.family.api.json'))).toEqual([])
  })
  it('o validador deteta divergências (sanidade)', () => {
    const bad = { ...fixture<HealthSummary>('health-summary.member.api.json'), extra: 1, memberId: 'x' }
    expect(contractErrors('HealthSummary', bad).length).toBeGreaterThan(0)
  })
})

describe('mock cumpre o openapi', () => {
  it('HealthSummary de um membro com dados', async () => {
    const memberId = db.members.find((m) => m.familyId === FAMILY)?.id ?? ''
    const s = await getMemberHealthSummary(FAMILY, USER, memberId, {}, NOW)
    expect(contractErrors('HealthSummary', JSON.parse(JSON.stringify(s)), { ignoreUuid: true })).toEqual([])
  })
  it('HealthSummary com período curto', async () => {
    const memberId = db.members.find((m) => m.familyId === FAMILY)?.id ?? ''
    const s = await getMemberHealthSummary(FAMILY, USER, memberId, { from: '2026-09-20', to: '2026-10-14' }, NOW)
    expect(contractErrors('HealthSummary', JSON.parse(JSON.stringify(s)), { ignoreUuid: true })).toEqual([])
  })
  it('FamilyHealthSummary', async () => {
    const s = await getFamilyHealthSummary(FAMILY, USER, {}, NOW)
    expect(contractErrors('FamilyHealthSummary', JSON.parse(JSON.stringify(s)), { ignoreUuid: true })).toEqual([])
  })
})
