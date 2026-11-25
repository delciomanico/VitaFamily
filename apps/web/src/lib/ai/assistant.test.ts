import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockOutcomes } from '@/mocks/handlers/ai'
import { aiService } from '@/services/ai.service'
import type { AiProviderId } from '@/types/ai'
import { resetAssistantForTests, runAssistant } from './assistant'
import { ProviderError, setProviderOverrideForTests } from './providers'

const FAMILY = 'fam-1'
const MEMBER = 'mem-1'
const base = { familyId: FAMILY, memberId: MEMBER, provider: 'CLAUDE' as AiProviderId }
const good = JSON.stringify({ summary: 'A adesão manteve-se estável.', observations: ['Uma semana mais baixa.'], generalGuidance: ['Manter o registo ajuda.'], urgency: 'ROUTINE' })
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(async () => {
  aiService.resetForTests()
  resetAssistantForTests()
  await aiService.grantConsent(FAMILY, MEMBER, 'CLAUDE', 'v1')
})
afterEach(() => {
  setProviderOverrideForTests(undefined)
  vi.restoreAllMocks()
})

describe('análise de sintomas (UC-AI-03)', () => {
  it('sinal de alarme: mensagem fixa JÁ, sem chamar o fornecedor, e desfecho ALARM em melhor esforço', async () => {
    const provider = vi.fn(() => Promise.resolve(good))
    setProviderOverrideForTests(provider)
    const result = await runAssistant({ ...base, kind: 'SYMPTOMS', symptoms: 'Tenho uma dor forte no peito há uma hora' })
    expect(result).toMatchObject({ kind: 'ALARM', message: expect.stringContaining('urgência') as unknown as string })
    expect(provider).not.toHaveBeenCalled()
    await flush()
    expect(mockOutcomes()).toEqual([{ memberId: MEMBER, outcome: 'ALARM' }])
  })

  it('resposta válida: mostra-a com o aviso e reporta COMPLETED; os sintomas só vão ao fornecedor, nunca à Vita', async () => {
    const provider = vi.fn((_c: unknown, request: { user: string }) => Promise.resolve(request.user.length > 0 ? good : ''))
    setProviderOverrideForTests(provider)
    const sessions = vi.spyOn(aiService, 'createSession')
    const result = await runAssistant({ ...base, kind: 'SYMPTOMS', symptoms: 'Tosse seca há dois dias', includeContext: true })
    expect(result).toMatchObject({ kind: 'ANSWER', disclaimer: expect.stringContaining('Informação geral gerada por IA') as unknown as string })
    expect(provider).toHaveBeenCalledOnce()
    expect(provider.mock.calls[0]?.[1].user).toContain('Tosse seca há dois dias')
    // O pedido ao servidor não leva o texto dos sintomas (BR-AI-10).
    expect(JSON.stringify(sessions.mock.calls)).not.toContain('Tosse')
    expect(sessions.mock.calls[0]?.[2]).toMatchObject({ kind: 'SYMPTOMS', includeContext: true })
    await flush()
    expect(mockOutcomes().at(-1)).toEqual({ memberId: MEMBER, outcome: 'COMPLETED' })
  })

  it('resposta com medicamento/dose é BLOQUEADA por inteiro; nada do texto do modelo aparece', async () => {
    setProviderOverrideForTests(() => Promise.resolve(JSON.stringify({ summary: 'Tome ibuprofeno 400 mg.', observations: [], generalGuidance: [], urgency: 'NONE' })))
    const result = await runAssistant({ ...base, kind: 'SYMPTOMS', symptoms: 'Dor de cabeça ligeira' })
    expect(result.kind).toBe('BLOCKED')
    expect(JSON.stringify(result)).not.toMatch(/ibuprofeno|400/)
    await flush()
    expect(mockOutcomes().at(-1)?.outcome).toBe('BLOCKED')
  })

  it('o modelo sinaliza urgência ⇒ mensagem fixa em vez do texto', async () => {
    setProviderOverrideForTests(() => Promise.resolve(JSON.stringify({ summary: 'Parece grave, vá já.', observations: [], generalGuidance: [], urgency: 'EMERGENCY' })))
    const result = await runAssistant({ ...base, kind: 'SYMPTOMS', symptoms: 'Cansaço depois do trabalho' })
    expect(result.kind).toBe('ALARM')
    expect(JSON.stringify(result)).not.toContain('Parece grave')
  })

  it('lixo (não JSON) ⇒ sem resposta (falha fechada)', async () => {
    setProviderOverrideForTests(() => Promise.resolve('Claro! Tome um comprimido.'))
    expect((await runAssistant({ ...base, kind: 'SYMPTOMS', symptoms: 'Cansaço' })).kind).toBe('BLOCKED')
  })

  it('sem consentimento ativo ⇒ erro de consentimento e o fornecedor não é chamado', async () => {
    await aiService.revokeConsent(FAMILY, MEMBER, 'CLAUDE')
    const provider = vi.fn(() => Promise.resolve(good))
    setProviderOverrideForTests(provider)
    expect(await runAssistant({ ...base, kind: 'SYMPTOMS', symptoms: 'Cansaço' })).toMatchObject({ kind: 'ERROR', code: 'CONSENT' })
    expect(provider).not.toHaveBeenCalled()
  })

  it.each([
    ['AUTH', 'AUTH'],
    ['QUOTA', 'QUOTA'],
    ['NETWORK', 'NETWORK'],
    ['FAILED', 'FAILED'],
  ] as const)('falha do fornecedor %s ⇒ erro simples e desfecho FAILED', async (failure, code) => {
    setProviderOverrideForTests(() => Promise.reject(new ProviderError(failure)))
    expect(await runAssistant({ ...base, kind: 'SYMPTOMS', symptoms: 'Cansaço' })).toMatchObject({ kind: 'ERROR', code })
    await flush()
    expect(mockOutcomes().at(-1)?.outcome).toBe('FAILED')
  })

  it('guardrails indisponíveis ⇒ falha fechada, nunca chama o fornecedor', async () => {
    vi.spyOn(aiService, 'getGuardrails').mockRejectedValue(new Error('rede'))
    const provider = vi.fn(() => Promise.resolve(good))
    setProviderOverrideForTests(provider)
    expect(await runAssistant({ ...base, kind: 'SYMPTOMS', symptoms: 'Cansaço' })).toMatchObject({ kind: 'ERROR', code: 'GUARDRAILS' })
    expect(provider).not.toHaveBeenCalled()
  })
})

describe('resumo com IA (UC-AI-02)', () => {
  it('envia o contexto minimizado (etiquetas «Medicamento A», dias relativos) e mostra a resposta', async () => {
    const provider = vi.fn((_c: unknown, request: { user: string }) => Promise.resolve(request.user.includes('Medicamento A') ? good : ''))
    setProviderOverrideForTests(provider)
    const result = await runAssistant({ ...base, kind: 'SUMMARY', from: '2026-01-01', to: '2026-06-30' })
    expect(result.kind).toBe('ANSWER')
    const prompt = provider.mock.calls[0]?.[1].user ?? ''
    expect(prompt).toContain('dayOffset')
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('guardrails desatualizados (409) ⇒ recarrega uma vez e repete', async () => {
    const sessions = vi.spyOn(aiService, 'createSession')
    const { AppError } = await import('@/lib/errors')
    sessions.mockRejectedValueOnce(new AppError('CONFLICT'))
    setProviderOverrideForTests(() => Promise.resolve(good))
    expect((await runAssistant({ ...base, kind: 'SUMMARY' })).kind).toBe('ANSWER')
    expect(sessions).toHaveBeenCalledTimes(2)
  })
})
