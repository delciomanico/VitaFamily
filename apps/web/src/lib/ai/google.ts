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
  window.opener?.postMessage({ type: MESSAGE_TYPE, ...result }, window.location.origin)
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
    const finish = (action: () => void) => {
      window.removeEventListener('message', onMessage)
      window.clearInterval(watch)
      action()
    }
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return
      const data = event.data as { type?: string; token?: string; expiresIn?: number; state?: string; error?: string } | null
      if (data?.type !== MESSAGE_TYPE) return
      if (data.error || !data.token || data.state !== state) return finish(() => reject(new Error(data.error ?? 'OAUTH_FAILED')))
      current = { token: data.token, expiresAt: Date.now() + (data.expiresIn ?? 3600) * 1000 }
      finish(() => resolve(data.token as string))
    }
    const watch = window.setInterval(() => {
      if (popup.closed) finish(() => reject(new Error('OAUTH_CANCELLED')))
    }, 500)
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
