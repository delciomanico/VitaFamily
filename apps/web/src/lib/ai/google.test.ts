import { describe, expect, it } from 'vitest'
import { cachedGoogleToken, clearGoogleToken, parseOAuthHash } from './google'

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
