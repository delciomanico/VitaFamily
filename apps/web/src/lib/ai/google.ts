/*
 * «Continuar com Google» para o Gemini (BR-AI-01/02, ADR-039): autorização OAuth num pop-up (fluxo implícito, SEM script de terceiros na app).
 * O *access token* vive SÓ em memória (~1 h) e não há *refresh token* num SPA: expirado, pede-se novo consentimento (silencioso se a sessão Google
 * o permitir). O `client ID` é do projeto Google Cloud da Vita (OP-132); sem ele o Gemini não é oferecido. O âmbito e a verificação da app
 * pela Google estão por confirmar no *spike* (OP-133).
 */

export const GOOGLE_REDIRECT_PATH = '/oauth/google'
/** Âmbito da Generative Language API (a confirmar no spike OP-133). */
const SCOPE = 'https://www.googleapis.com/auth/generative-language.retriever'
const MESSAGE_TYPE = 'vita-google-oauth'
/** Tempo máximo para o utilizador concluir a autorização. */
export const OAUTH_TIMEOUT_MS = 120_000
/** Depois de o pop-up fechar, ainda se espera pela mensagem (pode chegar a seguir). */
const CLOSED_GRACE_MS = 1_500

/** Segundo canal (mesma origem): a política COOP da página da Google pode cortar o `window.opener` do pop-up. */
const openChannel = (): BroadcastChannel | null => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(MESSAGE_TYPE))

export const googleClientId = (): string | undefined => {
  const id = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim()
  return id ? id : undefined
}

interface TokenState {
  token: string
  expiresAt: number
}
let current: TokenState | null = null

/** Token válido em memória (com margem de 60 s), se existir. */
export function cachedGoogleToken(now = Date.now()): string | null {
  return current && current.expiresAt - 60_000 > now ? current.token : null
}

export function clearGoogleToken(): void {
  current = null
}

/** Interpreta o fragmento do redirecionamento (`#access_token=…&expires_in=…&state=…`). */
export function parseOAuthHash(hash: string): { token?: string; expiresIn?: number; state?: string; error?: string } {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const error = params.get('error')
  if (error) return { error }
  const token = params.get('access_token')
  if (!token) return { error: 'no_token' }
  const expiresIn = Number(params.get('expires_in') ?? '3600')
  const state = params.get('state')
  return { token, expiresIn: Number.isFinite(expiresIn) ? expiresIn : 3600, ...(state ? { state } : {}) }
}

/** Chamado pela página de retorno (`/oauth/google`): entrega o resultado ao pop-up-pai e fecha. */
export function deliverOAuthResult(hash: string): void {
  const result = parseOAuthHash(hash)
  const message = { type: MESSAGE_TYPE, ...result }
  window.opener?.postMessage(message, window.location.origin)
  const channel = openChannel()
  channel?.postMessage(message)
  channel?.close()
  window.close()
}

/** Abre o pop-up de consentimento Google e devolve o token (só em memória). Tem de ser chamado a partir de um toque do utilizador. */
export function requestGoogleToken(): Promise<string> {
  const clientId = googleClientId()
  if (!clientId) return Promise.reject(new Error('GOOGLE_NOT_CONFIGURED'))
  const cached = cachedGoogleToken()
  if (cached) return Promise.resolve(cached)
  const state = globalThis.crypto.randomUUID()
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${window.location.origin}${GOOGLE_REDIRECT_PATH}`,
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
    prompt: 'select_account',
  }).toString()
  const popup = window.open(url.toString(), 'vita-google-oauth', 'popup,width=480,height=640')
  if (!popup) return Promise.reject(new Error('POPUP_BLOCKED'))
  return new Promise<string>((resolve, reject) => {
    const channel = openChannel()
    let closedAt: number | null = null
    let done = false
    const finish = (action: () => void) => {
      if (done) return
      done = true
      window.removeEventListener('message', onMessage)
      window.clearInterval(watch)
      window.clearTimeout(limit)
      channel?.close()
      action()
    }
    type Message = { type?: string; token?: string; expiresIn?: number; state?: string; error?: string } | null
    const accept = (data: Message) => {
      if (data?.error || !data?.token || data.state !== state) return finish(() => reject(new Error(data?.error ?? 'OAUTH_FAILED')))
      current = { token: data.token, expiresAt: Date.now() + (data.expiresIn ?? 3600) * 1000 }
      finish(() => resolve(data.token as string))
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as Message
      if (data?.type === MESSAGE_TYPE) accept(data)
    }
    // No canal partilhado só conta a resposta a ESTE pedido (outro separador pode estar a autorizar ao mesmo tempo).
    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        const data = event.data as Message
        if (data?.type === MESSAGE_TYPE && data.state === state) accept(data)
      }
    }
    const watch = window.setInterval(() => {
      if (!popup.closed) return
      closedAt ??= Date.now()
      if (Date.now() - closedAt >= CLOSED_GRACE_MS) finish(() => reject(new Error('OAUTH_CANCELLED')))
    }, 500)
    const limit = window.setTimeout(() => finish(() => reject(new Error('OAUTH_CANCELLED'))), OAUTH_TIMEOUT_MS)
    window.addEventListener('message', onMessage)
  })
}

/** Revoga o token no endpoint da Google (melhor esforço) e esquece-o. */
export async function revokeGoogleToken(): Promise<void> {
  const token = current?.token
  current = null
  if (!token) return
  try {
    await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }), credentials: 'omit' })
  } catch {
    // Melhor esforço: o token expira sozinho.
  }
}
