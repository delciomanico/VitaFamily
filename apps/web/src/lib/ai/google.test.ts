import { afterEach, describe, expect, it, vi } from 'vitest'
import { cachedGoogleToken, clearGoogleToken, deliverOAuthResult, OAUTH_TIMEOUT_MS, parseOAuthHash, requestGoogleToken } from './google'

describe('Continuar com Google', () => {
  it('lê o fragmento do retorno', () => {
    expect(parseOAuthHash('#access_token=ya29.x&expires_in=3599&state=abc&token_type=Bearer')).toEqual({ token: 'ya29.x', expiresIn: 3599, state: 'abc' })
    expect(parseOAuthHash('#error=access_denied')).toEqual({ error: 'access_denied' })
    expect(parseOAuthHash('')).toEqual({ error: 'no_token' })
  })
  it('o token só existe em memória e começa vazio', () => {
    clearGoogleToken()
    expect(cachedGoogleToken()).toBeNull()
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0)
  })
})

describe('pop-up da Google', () => {
  afterEach(() => {
    clearGoogleToken()
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  const openPopup = () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'cliente-de-teste')
    const popup = { closed: false }
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window)
    const pending = requestGoogleToken()
    const state = new URL(String(open.mock.calls[0]?.[0])).searchParams.get('state') as string
    return { popup, pending, state }
  }

  it('sem window.opener (COOP), o token chega pelo canal da mesma origem', async () => {
    const { pending, state } = openPopup()
    vi.spyOn(window, 'close').mockImplementation(() => undefined)
    deliverOAuthResult(`#access_token=outro&state=de-outro-pedido`) // ignorado: outro pedido
    deliverOAuthResult(`#access_token=ya29.canal&expires_in=3600&state=${state}`)
    await expect(pending).resolves.toBe('ya29.canal')
  })

  it('sem resposta, desiste ao fim do tempo máximo em vez de ficar à espera para sempre', async () => {
    vi.useFakeTimers()
    const { pending } = openPopup()
    const outcome = pending.catch((e: Error) => e.message)
    await vi.advanceTimersByTimeAsync(OAUTH_TIMEOUT_MS)
    expect(await outcome).toBe('OAUTH_CANCELLED')
  })
})
