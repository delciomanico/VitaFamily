import { beforeEach, describe, expect, it } from 'vitest'
import fixture from '@/lib/ai/fixtures/guardrails.json'
import { createSession, getGuardrails, grantConsent, resetAiMock } from '@/mocks/handlers/ai'
import { contractErrors } from './openapiSchema'

/*
 * Contrato do assistente (M18): o fixture dos guardrails (o MESMO usado nos testes do cliente e gerado pelo código do servidor) e as respostas do
 * mock têm de cumprir o openapi. Recapturar o fixture quando as listas do servidor mudarem (nova versão).
 */
beforeEach(() => resetAiMock())

describe('assistente de IA cumpre o openapi', () => {
  it('guardrails (fixture partilhado) ⇒ AiGuardrails', async () => {
    expect(contractErrors('AiGuardrails', fixture)).toEqual([])
    expect(contractErrors('AiGuardrails', await getGuardrails())).toEqual([])
    // Todos os padrões compilam (sintaxe comum a JavaScript e ao servidor).
    for (const p of [...fixture.blockPatterns, ...fixture.alarmPatterns]) expect(() => new RegExp(p.pattern, p.flags)).not.toThrow()
  })

  it('consentimento e sessões do mock ⇒ AiConsent / AiSession', async () => {
    const consent = await grantConsent('m1', 'CLAUDE', 'v1')
    expect(contractErrors('AiConsent', consent)).toEqual([])
    const version = fixture.version
    const summary = await createSession('m1', { provider: 'CLAUDE', kind: 'SUMMARY', guardrailsVersion: version })
    expect(contractErrors('AiSession', summary, { ignoreUuid: true })).toEqual([])
    const symptoms = await createSession('m1', { provider: 'CLAUDE', kind: 'SYMPTOMS', guardrailsVersion: version, includeContext: true })
    expect(contractErrors('AiSession', symptoms, { ignoreUuid: true })).toEqual([])
    expect(contractErrors('AiConsent', { ...consent, extra: 1 })).not.toEqual([])
  })
})
