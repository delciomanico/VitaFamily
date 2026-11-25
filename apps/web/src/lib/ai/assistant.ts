import { isAppError } from '@/lib/errors'
import { aiService } from '@/services/ai.service'
import type { AiGuardrails, AiKind, AiOutcome, AiProviderId, AiResult, AiSession } from '@/types/ai'
import { detectAlarm, parseAnswer } from './guardrails'
import { requestGoogleToken, cachedGoogleToken } from './google'
import { keyStore } from './keyStore'
import { buildPrompt } from './prompts'
import { callProvider, ProviderError, type ProviderCredential } from './providers'
import { hasApiBackend } from '@/lib/apiClient'

/*
 * Orquestração de uma análise (ADR-039, «Fluxo»): guardrails → (sintomas) detetor de alarme LOCAL → sessão no servidor (autoriza, consentimento,
 * contexto minimizado) → chamada ao fornecedor a partir DESTE aparelho → validação por esquema + filtro de saída → desfecho (melhor esforço).
 * Falha fechada: qualquer problema ⇒ nunca se mostra texto do modelo. Nada disto regista sintomas, contexto, respostas nem chaves.
 */

const MESSAGES = {
  noCredential: 'Ligue primeiro o assistente a um fornecedor.',
  consent: 'Ative o assistente e aceite o consentimento para continuar.',
  auth: 'O fornecedor recusou a ligação. Confirme a chave ou volte a entrar com a Google.',
  quota: 'O fornecedor atingiu o limite de pedidos. Tente mais tarde.',
  network: 'Não foi possível contactar o fornecedor. Verifique a ligação.',
  rate: 'Fez muitos pedidos seguidos. Espere um pouco e tente de novo.',
  guardrails: 'Não foi possível preparar o assistente. Tente mais tarde.',
  failed: 'Não foi possível obter a resposta. Tente de novo.',
  blocked: 'Não foi possível mostrar uma resposta segura. Em caso de dúvida, fale com um profissional de saúde.',
}

const error = (code: Extract<AiResult, { kind: 'ERROR' }>['code'], message: string): AiResult => ({ kind: 'ERROR', code, message })

let cached: AiGuardrails | undefined

/** Guardrails vigentes (cache em memória; recarrega com `force`, por exemplo depois de um 409). */
export async function loadGuardrails(force = false): Promise<AiGuardrails> {
  if (!cached || force) cached = await aiService.getGuardrails()
  return cached
}

export function resetAssistantForTests(): void {
  cached = undefined
}

async function credentialFor(provider: AiProviderId): Promise<ProviderCredential | null> {
  if (!hasApiBackend()) return { kind: 'apiKey', key: 'demo' }
  if (provider === 'GEMINI') {
    const token = cachedGoogleToken() ?? (await requestGoogleToken().catch(() => null))
    return token ? { kind: 'token', token } : null
  }
  const key = await keyStore().load(provider)
  return key ? { kind: 'apiKey', key } : null
}

function report(familyId: string, memberId: string, session: AiSession | null, outcome: AiOutcome): void {
  if (!session) return
  void aiService.reportOutcome(familyId, memberId, session.sessionToken, outcome).catch(() => undefined)
}

export interface RunInput {
  familyId: string
  memberId: string
  provider: AiProviderId
  kind: AiKind
  /** SUMMARY. */
  from?: string
  to?: string
  /** SYMPTOMS: texto escrito pelo utilizador (nunca vai para o servidor) e se inclui o contexto (condições ativas). */
  symptoms?: string
  includeContext?: boolean
}

async function openSession(input: RunInput, guardrails: AiGuardrails): Promise<{ session: AiSession; guardrails: AiGuardrails }> {
  const body = { provider: input.provider, kind: input.kind, guardrailsVersion: guardrails.version, ...(input.from ? { from: input.from } : {}), ...(input.to ? { to: input.to } : {}), ...(input.includeContext ? { includeContext: true } : {}) }
  try {
    return { session: await aiService.createSession(input.familyId, input.memberId, body), guardrails }
  } catch (err) {
    if (!isAppError(err, 'CONFLICT')) throw err
    // Guardrails desatualizados: recarrega uma vez e repete.
    const fresh = await loadGuardrails(true)
    return { session: await aiService.createSession(input.familyId, input.memberId, { ...body, guardrailsVersion: fresh.version }), guardrails: fresh }
  }
}

export async function runAssistant(input: RunInput): Promise<AiResult> {
  let guardrails: AiGuardrails
  try {
    guardrails = await loadGuardrails()
  } catch {
    return error('GUARDRAILS', MESSAGES.guardrails)
  }

  // Sinais de alarme: mensagem fixa JÁ (nunca espera pela rede), sem análise e sem fornecedor; o desfecho vai em melhor esforço.
  if (input.kind === 'SYMPTOMS' && detectAlarm(input.symptoms ?? '', guardrails)) {
    void openSession(input, guardrails).then(({ session }) => report(input.familyId, input.memberId, session, 'ALARM')).catch(() => undefined)
    return { kind: 'ALARM', message: guardrails.urgencyMessage }
  }

  // A credencial pede-se antes da sessão (o pop-up Google exige o toque do utilizador ainda «quente»).
  const credential = await credentialFor(input.provider)
  if (!credential) return error('NO_CREDENTIAL', MESSAGES.noCredential)

  let session: AiSession
  try {
    ;({ session, guardrails } = await openSession(input, guardrails))
  } catch (err) {
    if (isAppError(err, 'FORBIDDEN')) return error('CONSENT', MESSAGES.consent)
    if (isAppError(err, 'RATE_LIMITED')) return error('RATE', MESSAGES.rate)
    return error('FAILED', MESSAGES.failed)
  }

  let raw: string
  try {
    const prompt = buildPrompt(input.kind, guardrails, session.context, input.symptoms)
    raw = await callProvider(input.provider, credential, prompt)
  } catch (err) {
    report(input.familyId, input.memberId, session, 'FAILED')
    const failure = err instanceof ProviderError ? err.failure : 'FAILED'
    if (failure === 'AUTH') return error('AUTH', MESSAGES.auth)
    if (failure === 'QUOTA') return error('QUOTA', MESSAGES.quota)
    if (failure === 'NETWORK') return error('NETWORK', MESSAGES.network)
    return error('FAILED', MESSAGES.failed)
  }

  const filtered = parseAnswer(raw, guardrails)
  if (!filtered.ok) {
    if (filtered.reason === 'ALARM') {
      report(input.familyId, input.memberId, session, 'ALARM')
      return { kind: 'ALARM', message: guardrails.urgencyMessage }
    }
    report(input.familyId, input.memberId, session, 'BLOCKED')
    return { kind: 'BLOCKED', message: MESSAGES.blocked }
  }
  report(input.familyId, input.memberId, session, 'COMPLETED')
  return { kind: 'ANSWER', answer: filtered.answer, disclaimer: guardrails.disclaimer }
}
