import { hasApiBackend } from '@/lib/apiClient'
import type { AiProviderId } from '@/types/ai'

/*
 * Adaptadores dos fornecedores de IA (porta `callProvider`; ADR-015: substituíveis). A chamada sai DIRETAMENTE do dispositivo para o fornecedor
 * (BR-AI-01): a Vita não faz de relé. CORS e quotas por fornecedor ficam por confirmar no *spike* (OP-133): um fornecedor sem CORS utilizável
 * não deve ser oferecido. Nunca se regista nem se propaga o corpo de uma resposta de erro (pode conter dados): só uma categoria.
 */

export type ProviderCredential = { kind: 'apiKey'; key: string } | { kind: 'token'; token: string }
export type ProviderFailure = 'AUTH' | 'QUOTA' | 'NETWORK' | 'FAILED'

export class ProviderError extends Error {
  constructor(readonly failure: ProviderFailure) {
    super(failure)
    this.name = 'ProviderError'
  }
}

export interface ProviderRequest {
  system: string
  user: string
}

export interface ProviderInfo {
  id: AiProviderId
  /** Nome para o utilizador. */
  label: string
  /** Como se liga: login Google ou chave de API da conta de programador do utilizador. */
  connect: 'google' | 'apiKey'
  /** Onde o utilizador cria a chave (texto, sem ligação com dados). */
  keyHelp?: string
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'GEMINI', label: 'Gemini (Google)', connect: 'google' },
  { id: 'CLAUDE', label: 'Claude (Anthropic)', connect: 'apiKey', keyHelp: 'Crie uma chave de API na sua conta de programador da Anthropic (console.anthropic.com).' },
  { id: 'OPENAI', label: 'ChatGPT (OpenAI)', connect: 'apiKey', keyHelp: 'Crie uma chave de API na sua conta de programador da OpenAI (platform.openai.com).' },
]

export const providerLabel = (id: AiProviderId): string => PROVIDERS.find((p) => p.id === id)?.label ?? id

/** Modelos por omissão (configuráveis aqui; confirmar disponibilidade na conta do utilizador, OP-133). */
const MODELS = { CLAUDE: 'claude-haiku-5-5', OPENAI: 'gpt-4o-mini', GEMINI: 'gemini-2.0-flash' } as const
const MAX_TOKENS = 1400

function failureFor(status: number): ProviderFailure {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'QUOTA'
  return 'FAILED'
}

async function post(url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal, credentials: 'omit', referrerPolicy: 'no-referrer' })
  } catch {
    throw new ProviderError('NETWORK')
  }
  if (!response.ok) throw new ProviderError(failureFor(response.status))
  try {
    return (await response.json()) as unknown
  } catch {
    throw new ProviderError('FAILED')
  }
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

type Adapter = (credential: ProviderCredential, request: ProviderRequest, signal?: AbortSignal) => Promise<string>

const secret = (credential: ProviderCredential): string => (credential.kind === 'apiKey' ? credential.key : credential.token)

const adapters: Record<AiProviderId, Adapter> = {
  CLAUDE: async (credential, { system, user }, signal) => {
    const data = (await post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': secret(credential), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      { model: MODELS.CLAUDE, max_tokens: MAX_TOKENS, system, messages: [{ role: 'user', content: user }] },
      signal,
    )) as { content?: Array<{ text?: unknown }> }
    return text(data.content?.[0]?.text)
  },
  OPENAI: async (credential, { system, user }, signal) => {
    const data = (await post(
      'https://api.openai.com/v1/chat/completions',
      { Authorization: `Bearer ${secret(credential)}` },
      { model: MODELS.OPENAI, max_tokens: MAX_TOKENS, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] },
      signal,
    )) as { choices?: Array<{ message?: { content?: unknown } }> }
    return text(data.choices?.[0]?.message?.content)
  },
  GEMINI: async (credential, { system, user }, signal) => {
    const data = (await post(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI}:generateContent`,
      { Authorization: `Bearer ${secret(credential)}` },
      { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { responseMimeType: 'application/json', maxOutputTokens: MAX_TOKENS } },
      signal,
    )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }> }
    return text(data.candidates?.[0]?.content?.parts?.[0]?.text)
  },
}

/** Resposta de demonstração (sem backend real não há fornecedor nem dados: nada sai do dispositivo). */
const DEMO_ANSWER = JSON.stringify({
  summary: 'Este é um exemplo de demonstração: as tomas confirmadas mantiveram-se estáveis no período.',
  observations: ['A adesão foi mais baixa numa das semanas do período.', 'Houve poucos exames com resultados registados.'],
  generalGuidance: ['Manter o registo das tomas ajuda a ver a evolução.', 'Se tiver dúvidas sobre os resultados, fale com um profissional de saúde.'],
  urgency: 'ROUTINE',
})

let override: Adapter | undefined
/** Só para testes: substitui a chamada ao fornecedor. */
export function setProviderOverrideForTests(adapter: Adapter | undefined): void {
  override = adapter
}

/** Chama o fornecedor com a credencial do utilizador e devolve o texto cru da resposta (a validar/filtrar a seguir). */
export async function callProvider(id: AiProviderId, credential: ProviderCredential, request: ProviderRequest, signal?: AbortSignal): Promise<string> {
  if (override) return override(credential, request, signal)
  if (!hasApiBackend()) return DEMO_ANSWER
  return adapters[id](credential, request, signal)
}
