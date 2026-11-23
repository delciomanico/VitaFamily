import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
let backend = true
vi.mock('./apiClient', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args), hasApiBackend: () => backend }))

const KEY = 'BNd8u4dbM90K32BWOSb9KHmhTE6oaRbXk5Sva0Yo8AunFn9doxp6TADOsCDIJ9UhSRlIdjg6GgqMBsCGZZmevpc'

function installBrowser(options: { permission?: NotificationPermission; request?: NotificationPermission; subscription?: unknown } = {}) {
  const subscription = {
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p256', auth: 'au' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
  const existing = options.subscription === undefined ? null : subscription
  const pushManager = { getSubscription: vi.fn().mockResolvedValue(existing), subscribe: vi.fn().mockResolvedValue(subscription) }
  const Notif = { permission: options.permission ?? 'default', requestPermission: vi.fn().mockResolvedValue(options.request ?? 'granted') }
  vi.stubGlobal('Notification', Notif)
  vi.stubGlobal('PushManager', class {})
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ pushManager }) } })
  return { pushManager, Notif, subscription }
}

async function load(key: string | undefined = KEY) {
  vi.resetModules()
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', key ?? '')
  return import('./push')
}

beforeEach(() => {
  apiFetch.mockReset()
  apiFetch.mockResolvedValue({ id: 'sub-1' })
  backend = true
  localStorage.clear()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  Reflect.deleteProperty(navigator, 'serviceWorker')
})

describe('urlBase64ToUint8Array', () => {
  it('converte a chave VAPID (65 bytes, 0x04 inicial)', async () => {
    const { urlBase64ToUint8Array } = await load()
    const bytes = urlBase64ToUint8Array(KEY)
    expect(bytes).toHaveLength(65)
    expect(bytes[0]).toBe(4)
  })
})

describe('pushSupport', () => {
  it('não suportado quando faltam as APIs', async () => {
    Reflect.deleteProperty(window, 'PushManager')
    const { pushSupport } = await load()
    expect(pushSupport(KEY).status).toBe('unsupported')
  })

  it('iOS fora da PWA instalada pede instalação', async () => {
    Reflect.deleteProperty(window, 'PushManager')
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari')
    const { pushSupport } = await load()
    expect(pushSupport(KEY).status).toBe('ios-install-required')
  })

  it('sem chave VAPID no build: não configurado', async () => {
    installBrowser()
    const { pushSupport } = await load('')
    expect(pushSupport().status).toBe('not-configured')
  })

  it('permissão bloqueada', async () => {
    installBrowser({ permission: 'denied' })
    const { pushSupport } = await load()
    expect(pushSupport().status).toBe('denied')
  })
})

describe('enablePush', () => {
  it('pede autorização, subscreve com a chave VAPID e regista na API', async () => {
    const { pushManager, Notif } = installBrowser()
    const { enablePush } = await load()
    expect((await enablePush()).status).toBe('supported')
    expect(Notif.requestPermission).toHaveBeenCalledTimes(1)
    const arg = pushManager.subscribe.mock.calls[0]?.[0] as { userVisibleOnly: boolean; applicationServerKey: Uint8Array }
    expect(arg.userVisibleOnly).toBe(true)
    expect(arg.applicationServerKey).toHaveLength(65)
    expect(apiFetch).toHaveBeenCalledWith('/users/me/push-subscriptions', {
      method: 'POST',
      body: expect.objectContaining({ endpoint: 'https://push.example/abc', p256dh: 'p256', auth: 'au' }),
    })
    expect(localStorage.getItem('vita.pushSubscriptionId')).toBe('sub-1')
  })

  it('reutiliza a subscrição existente do navegador', async () => {
    const { pushManager } = installBrowser({ permission: 'granted', subscription: {} })
    const { enablePush } = await load()
    await enablePush()
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('autorização recusada: não subscreve nem chama a API', async () => {
    const { pushManager } = installBrowser({ request: 'denied' })
    const { enablePush } = await load()
    expect((await enablePush()).status).toBe('denied')
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('sem backend (demo) só pede a autorização', async () => {
    backend = false
    const { pushManager } = installBrowser()
    const { enablePush } = await load()
    expect((await enablePush()).status).toBe('supported')
    expect(pushManager.subscribe).not.toHaveBeenCalled()
    expect(apiFetch).not.toHaveBeenCalled()
  })
})

describe('disablePush', () => {
  it('remove a subscrição na API e no navegador', async () => {
    const { subscription } = installBrowser({ permission: 'granted', subscription: {} })
    localStorage.setItem('vita.pushSubscriptionId', 'sub-1')
    const { disablePush } = await load()
    await disablePush()
    expect(apiFetch).toHaveBeenCalledWith('/users/me/push-subscriptions/sub-1', { method: 'DELETE' })
    expect(subscription.unsubscribe).toHaveBeenCalled()
    expect(localStorage.getItem('vita.pushSubscriptionId')).toBeNull()
  })

  it('404 da API não impede de cancelar a subscrição do navegador', async () => {
    const { subscription } = installBrowser({ permission: 'granted', subscription: {} })
    localStorage.setItem('vita.pushSubscriptionId', 'sub-1')
    apiFetch.mockRejectedValue(new Error('NOT_FOUND'))
    const { disablePush } = await load()
    await disablePush()
    expect(subscription.unsubscribe).toHaveBeenCalled()
  })
})
