import type { AiAnswer, AiGuardrails, AiPattern, AiUrgency } from '@/types/ai'

/*
 * Detetor de alarme e filtro de saída (BR-AI-07/09, ADR-039): correm NESTE dispositivo, porque o servidor nunca vê a resposta do fornecedor.
 * As listas, o esquema e os textos vêm do servidor (`GET /ai/guardrails`) e são os mesmos fixtures dos testes da API. FALHA FECHADA:
 * qualquer dúvida (JSON inválido, campo fora do esquema, padrão do bloqueio, urgência) ⇒ nada do texto do modelo é mostrado.
 */

/** Igual ao `normalizeForMatch` do servidor: minúsculas e sem acentos (os padrões foram escritos sobre este texto). */
export function normalizeForMatch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

function firstMatch(patterns: AiPattern[], normalized: string): AiPattern | null {
  for (const p of patterns) {
    try {
      if (new RegExp(p.pattern, p.flags).test(normalized)) return p
    } catch {
      // Padrão inválido ⇒ falha fechada: conta como correspondência.
      return p
    }
  }
  return null
}

/** Sinal de alarme no texto do utilizador (ou do modelo). Preferem-se falsos positivos. */
export function detectAlarm(text: string, guardrails: AiGuardrails): AiPattern | null {
  return firstMatch(guardrails.alarmPatterns, normalizeForMatch(text))
}

export type FilterFailure = 'SCHEMA' | 'BLOCKED' | 'ALARM'
export type FilterResult = { ok: true; answer: AiAnswer } | { ok: false; reason: FilterFailure }

const URGENCIES: readonly AiUrgency[] = ['NONE', 'ROUTINE', 'EMERGENCY']
const KEYS = ['summary', 'observations', 'generalGuidance', 'suggestedSpecialty', 'urgency']

function extractJson(raw: string): unknown {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown
  } catch {
    return undefined
  }
}

const isStringArray = (value: unknown, maxItems: number, maxLength: number): value is string[] =>
  Array.isArray(value) && value.length <= maxItems && value.every((item) => typeof item === 'string' && item.length <= maxLength)

/**
 * Resposta crua do modelo → resposta segura. Passos: JSON → esquema fechado → urgência → lista de bloqueio → alarme → especialidade do catálogo.
 * A resposta é bloqueada por INTEIRO (nunca texto cortado «às metades»).
 */
export function parseAnswer(raw: string, guardrails: AiGuardrails): FilterResult {
  const data = extractJson(raw)
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ok: false, reason: 'SCHEMA' }
  const obj = data as Record<string, unknown>
  if (Object.keys(obj).some((key) => !KEYS.includes(key))) return { ok: false, reason: 'SCHEMA' }
  const { summary, observations, generalGuidance, suggestedSpecialty, urgency } = obj
  if (typeof summary !== 'string' || summary.trim() === '' || summary.length > 1200) return { ok: false, reason: 'SCHEMA' }
  if (!isStringArray(observations, 8, 400) || !isStringArray(generalGuidance, 8, 400)) return { ok: false, reason: 'SCHEMA' }
  if (typeof urgency !== 'string' || !(URGENCIES as readonly string[]).includes(urgency)) return { ok: false, reason: 'SCHEMA' }
  if (suggestedSpecialty !== undefined && typeof suggestedSpecialty !== 'string') return { ok: false, reason: 'SCHEMA' }

  if (urgency === 'EMERGENCY') return { ok: false, reason: 'ALARM' }
  const normalized = normalizeForMatch([summary, ...observations, ...generalGuidance].join('\n'))
  if (firstMatch(guardrails.blockPatterns, normalized)) return { ok: false, reason: 'BLOCKED' }
  if (firstMatch(guardrails.alarmPatterns, normalized)) return { ok: false, reason: 'ALARM' }

  const specialty = suggestedSpecialty === undefined ? undefined : guardrails.allowedSpecialties.find((s) => s.id === suggestedSpecialty)
  return {
    ok: true,
    answer: {
      summary: summary.trim(),
      observations: observations.map((o) => o.trim()).filter(Boolean),
      generalGuidance: generalGuidance.map((g) => g.trim()).filter(Boolean),
      ...(specialty ? { suggestedSpecialty: { id: specialty.id, name: specialty.name } } : {}),
      urgency: urgency as AiUrgency,
    },
  }
}
