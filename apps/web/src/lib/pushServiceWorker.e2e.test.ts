// @vitest-environment node
// Handlers do service worker (public/push-sw.js, UC-ALR-06): carregados tal como o service worker os importa,
// com um `self` simulado.
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

interface Listener {
  (event: unknown): void
}

function loadWorker() {
  const code = readFileSync(new URL('../../public/push-sw.js', import.meta.url), 'utf8')
  const listeners: Record<string, Listener> = {}
  const showNotification = vi.fn().mockResolvedValue(undefined)
  const openWindow = vi.fn().mockResolvedValue(undefined)
  const matchAll = vi.fn().mockResolvedValue([])
  const scope = {
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn
    },
    registration: { showNotification },
    clients: { matchAll, openWindow },
  }
  const module = { exports: {} as Record<string, (...args: never[]) => unknown> }
  new Function('self', 'module', `${code}\n`).call(scope, scope, module)
  return { listeners, showNotification, openWindow, matchAll, exports: module.exports }
}

function pushEvent(text: string | null) {
  const waits: Promise<unknown>[] = []
  return {
    event: { data: text === null ? null : { text: () => text }, waitUntil: (p: Promise<unknown>) => waits.push(p) },
    done: () => Promise.all(waits),
  }
}

describe('service worker de push', () => {
  it('regista os handlers push e notificationclick', () => {
    const { listeners } = loadWorker()
    expect(Object.keys(listeners).sort()).toEqual(['notificationclick', 'push'])
  })

  it('mostra o título e o texto genéricos recebidos', async () => {
    const { listeners, showNotification } = loadWorker()
    const { event, done } = pushEvent(JSON.stringify({ title: 'Vita Family', body: 'Tem uma notificação nova. Abra a app para ver os detalhes.' }))
    listeners.push?.(event)
    await done()
    expect(showNotification).toHaveBeenCalledTimes(1)
    const [title, options] = showNotification.mock.calls[0] as [string, Record<string, unknown>]
    expect(title).toBe('Vita Family')
    expect(options).toMatchObject({ body: 'Tem uma notificação nova. Abra a app para ver os detalhes.', data: { url: '/app/alerts' } })
  })

  it.each([
    ['sem corpo', null],
    ['corpo vazio', ''],
    ['texto que não é JSON', 'olá'],
    ['JSON com tipos errados', JSON.stringify({ title: 1, body: { a: 1 } })],
  ])('mostra sempre uma notificação genérica (%s)', async (_name, text) => {
    const { listeners, showNotification } = loadWorker()
    const { event, done } = pushEvent(text)
    listeners.push?.(event)
    await done()
    expect(showNotification).toHaveBeenCalledWith('Vita Family', expect.objectContaining({ body: expect.stringContaining('Abra a app') }))
  })

  it('o clique fecha a notificação e abre os alertas quando não há janela aberta', async () => {
    const { listeners, openWindow } = loadWorker()
    const close = vi.fn()
    const waits: Promise<unknown>[] = []
    listeners.notificationclick?.({ notification: { close, data: { url: '/app/alerts' } }, waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
    expect(close).toHaveBeenCalled()
    expect(openWindow).toHaveBeenCalledWith('/app/alerts')
  })

  it('o clique reutiliza a janela aberta e leva-a aos alertas', async () => {
    const { listeners, matchAll, openWindow } = loadWorker()
    const focus = vi.fn().mockResolvedValue(undefined)
    const client = { focus, navigate: vi.fn().mockResolvedValue({ focus }) }
    matchAll.mockResolvedValue([client])
    const waits: Promise<unknown>[] = []
    listeners.notificationclick?.({ notification: { close: vi.fn(), data: {} }, waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)
    expect(client.navigate).toHaveBeenCalledWith('/app/alerts')
    expect(focus).toHaveBeenCalled()
    expect(openWindow).not.toHaveBeenCalled()
  })
})
