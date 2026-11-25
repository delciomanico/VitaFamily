import { describe, expect, it } from 'vitest'
import type { AiGuardrails } from '@/types/ai'
import fixture from './fixtures/guardrails.json'
import { detectAlarm, normalizeForMatch, parseAnswer } from './guardrails'

const g = fixture as unknown as AiGuardrails
const SPECIALTY = g.allowedSpecialties[0]?.id ?? ''

const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ summary: 'A adesão manteve-se estável.', observations: ['Houve uma semana mais baixa.'], generalGuidance: ['Manter o registo ajuda.'], urgency: 'NONE', ...over })

describe('detetor de alarme (BR-AI-07) — mesmos fixtures do servidor', () => {
  it('normaliza sem acentos e em minúsculas', () => expect(normalizeForMatch('Dor NO Peito — Coração')).toBe('dor no peito — coracao'))
  it.each([
    'Tenho uma dor forte no peito e no braço',
    'ESTOU COM FALTA DE AR',
    'a minha mãe tem a boca torta e a fala arrastada',
    'vomitou sangue',
    'o meu filho teve uma convulsão',
    'quero morrer',
    'bebeu veneno por engano',
    'o bebé com febre alta há horas',
  ])('alarme: %s', (text) => expect(detectAlarm(text, g)).not.toBeNull())
  it.each(['Tenho tosse seca há dois dias', 'Dor de cabeça ligeira ao fim do dia', 'Cansaço depois do trabalho'])('sem alarme: %s', (text) => expect(detectAlarm(text, g)).toBeNull())
  it('padrão inválido falha fechado (conta como correspondência)', () => expect(detectAlarm('x', { ...g, alarmPatterns: [{ id: 'mau', pattern: '(', flags: 'u' }] })).not.toBeNull())
})

describe('filtro de saída (BR-AI-09)', () => {
  it('aceita uma resposta no esquema e limpa o texto', () => {
    const r = parseAnswer(answer(), g)
    expect(r).toMatchObject({ ok: true, answer: { summary: 'A adesão manteve-se estável.', urgency: 'NONE' } })
  })
  it('aceita JSON dentro de ```json', () => expect(parseAnswer('```json\n' + answer() + '\n```', g).ok).toBe(true))
  it('especialidade só se for do catálogo; fora dele é descartada (a resposta mantém-se)', () => {
    const ok = parseAnswer(answer({ suggestedSpecialty: SPECIALTY }), g)
    expect(ok.ok && ok.answer.suggestedSpecialty?.id).toBe(SPECIALTY)
    const out = parseAnswer(answer({ suggestedSpecialty: '00000000-0000-4000-8000-000000000000' }), g)
    expect(out.ok && out.answer.suggestedSpecialty).toBeUndefined()
  })
  it.each([
    ['texto solto', 'Olá, tudo bem?'],
    ['campo a mais', answer({ extra: 'x' })],
    ['sem resumo', answer({ summary: '' })],
    ['urgência inválida', answer({ urgency: 'HIGH' })],
    ['lista longa', answer({ observations: Array.from({ length: 9 }, () => 'x') })],
    ['tipo errado', answer({ generalGuidance: 'não é lista' })],
    ['resumo enorme', answer({ summary: 'x'.repeat(1201) })],
  ])('esquema: %s ⇒ descartada', (_name, raw) => expect(parseAnswer(raw, g)).toEqual({ ok: false, reason: 'SCHEMA' }))
  it.each([
    'Você tem diabetes',
    'Tome ibuprofeno se tiver dor',
    'Deve tomar 500 mg de manhã',
    'Aumente a dose do medicamento',
    'Os valores são normais',
    'Não precisa de ir ao médico',
  ])('bloqueada por inteiro: %s', (text) => {
    expect(parseAnswer(answer({ generalGuidance: [text] }), g)).toEqual({ ok: false, reason: 'BLOCKED' })
    expect(parseAnswer(answer({ summary: text }), g)).toEqual({ ok: false, reason: 'BLOCKED' })
  })
  it('urgência EMERGENCY ou alarme no texto da resposta ⇒ ALARM (mensagem fixa em vez do texto)', () => {
    expect(parseAnswer(answer({ urgency: 'EMERGENCY' }), g)).toEqual({ ok: false, reason: 'ALARM' })
    expect(parseAnswer(answer({ observations: ['Referiu dor forte no peito.'] }), g)).toEqual({ ok: false, reason: 'ALARM' })
  })
  it.each(['A adesão às tomas desceu em outubro e subiu em novembro.', 'Os sintomas podem justificar uma consulta de Medicina Geral.', 'O parâmetro Glicose variou entre 90 e 101.'])(
    'permitido: %s',
    (text) => expect(parseAnswer(answer({ summary: text }), g).ok).toBe(true),
  )
})
