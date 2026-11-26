import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const REQUEST = { system: 'sistema', user: 'pedido' }

describe('adaptadores dos fornecedores (chamada direta do dispositivo, BR-AI-01)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let callProvider: typeof import('./providers').callProvider
  let ProviderError: typeof import('./providers').ProviderError

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('VITE_API_URL', '/api/v1') // com backend real os adaptadores são usados (sem backend devolvem a demonstração)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    ;({ callProvider, ProviderError } = await import('./providers'))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const reply = (body: unknown, status = 200) => fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }))
  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    return { url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) as Record<string, unknown>, init }
  }

  it('Claude: cabeçalho de acesso direto do navegador, chave só no cabeçalho, sem cookies nem referrer', async () => {
    reply({ content: [{ text: '{"ok":1}' }] })
    expect(await callProvider('CLAUDE', { kind: 'apiKey', key: 'sk-ant-1234' }, REQUEST)).toBe('{"ok":1}')
    const { url, headers, body, init } = sent()
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(headers['x-api-key']).toBe('sk-ant-1234')
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true')
    expect(body).toMatchObject({ system: 'sistema', messages: [{ role: 'user', content: 'pedido' }] })
    expect(JSON.stringify(body)).not.toContain('sk-ant-1234')
    expect(init.credentials).toBe('omit')
    expect(init.referrerPolicy).toBe('no-referrer')
  })

  it('OpenAI: Bearer e resposta em JSON', async () => {
    reply({ choices: [{ message: { content: '{"a":2}' } }] })
    expect(await callProvider('OPENAI', { kind: 'apiKey', key: 'sk-abc' }, REQUEST)).toBe('{"a":2}')
    const { url, headers, body } = sent()
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(headers.Authorization).toBe('Bearer sk-abc')
    expect(body.response_format).toEqual({ type: 'json_object' })
  })

  it('Gemini: token OAuth em Bearer (nunca na URL) e JSON pedido', async () => {
    reply({ candidates: [{ content: { parts: [{ text: '{"g":3}' }] } }] })
    expect(await callProvider('GEMINI', { kind: 'token', token: 'ya29.tok' }, REQUEST)).toBe('{"g":3}')
    const { url, headers, body } = sent()
    expect(url).toContain('generativelanguage.googleapis.com')
    expect(url).not.toContain('ya29')
    expect(headers.Authorization).toBe('Bearer ya29.tok')
    expect(JSON.stringify(body)).toContain('responseMimeType')
  })

  it.each([
    [401, 'AUTH'],
    [403, 'AUTH'],
    [429, 'QUOTA'],
    [400, 'FAILED'],
  ])('HTTP %i ⇒ %s, sem propagar o corpo do erro', async (status, failure) => {
    reply({ error: { message: 'dados sensíveis do pedido' } }, status)
    const error = await callProvider('CLAUDE', { kind: 'apiKey', key: 'k' }, REQUEST).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ProviderError)
    expect((error as InstanceType<typeof ProviderError>).failure).toBe(failure)
    expect(String((error as Error).message)).not.toContain('sensíveis')
  })

  it('HTTP 503 ⇒ uma nova tentativa e, se persistir, QUOTA («ocupado»)', async () => {
    vi.useFakeTimers()
    for (let i = 0; i < 4; i++) reply({ error: {} }, 503) // modelo principal e modelo leve, duas tentativas cada
    const pending = callProvider('GEMINI', { kind: 'token', token: 't' }, REQUEST).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(4000)
    expect(await pending).toMatchObject({ failure: 'QUOTA', status: 503 })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    vi.useRealTimers()
  })

  it('Gemini sobrecarregado (503) ⇒ responde com o modelo leve', async () => {
    vi.useFakeTimers()
    reply({ error: {} }, 503)
    reply({ error: {} }, 503)
    reply({ candidates: [{ content: { parts: [{ text: '{"leve":1}' }] } }] })
    const pending = callProvider('GEMINI', { kind: 'token', token: 't' }, REQUEST)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toBe('{"leve":1}')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('gemini-flash-latest')
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('gemini-flash-lite-latest')
    vi.useRealTimers()
  })

  it('fornecedor que nunca responde ⇒ desiste ao fim do tempo limite (QUOTA, «ocupado»)', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const pending = callProvider('GEMINI', { kind: 'token', token: 't' }, REQUEST).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(46_000)
    expect(await pending).toMatchObject({ failure: 'QUOTA' })
    vi.useRealTimers()
  })

  it('falha de rede ⇒ NETWORK; resposta que não é JSON ⇒ FAILED', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(callProvider('OPENAI', { kind: 'apiKey', key: 'k' }, REQUEST)).rejects.toMatchObject({ failure: 'NETWORK' })
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }))
    await expect(callProvider('OPENAI', { kind: 'apiKey', key: 'k' }, REQUEST)).rejects.toMatchObject({ failure: 'FAILED' })
  })

  it('sem backend (demonstração) nada sai do aparelho: devolve uma resposta de exemplo', async () => {
    vi.unstubAllEnvs()
    vi.stubEnv('VITE_API_URL', '')
    vi.resetModules()
    const demo = await import('./providers')
    const text = await demo.callProvider('CLAUDE', { kind: 'apiKey', key: 'demo' }, REQUEST)
    expect(JSON.parse(text)).toMatchObject({ urgency: 'ROUTINE' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
