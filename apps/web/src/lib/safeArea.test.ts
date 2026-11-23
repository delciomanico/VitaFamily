import { afterEach, describe, expect, it, vi } from 'vitest'
import { needsSafeAreaFallback } from './safeArea'

function setup(ua: string, standalone: boolean, screenH: number, innerH: number) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua)
  window.matchMedia = ((q: string) => ({ matches: standalone && q.includes('standalone'), media: q, addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia
  Object.defineProperty(window.screen, 'height', { value: screenH, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: innerH, configurable: true })
}
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-G998B) Chrome/130'

describe('margens de segurança no Android', () => {
  afterEach(() => vi.restoreAllMocks())
  it('liga o mínimo na PWA instalada quando a janela ocupa o ecrã todo', () => {
    setup(ANDROID, true, 915, 915)
    expect(needsSafeAreaFallback()).toBe(true)
  })
  it('não liga se as barras já retiram espaço à janela', () => {
    setup(ANDROID, true, 915, 840)
    expect(needsSafeAreaFallback()).toBe(false)
  })
  it('não liga no navegador (não instalada) nem fora do Android', () => {
    setup(ANDROID, false, 915, 915)
    expect(needsSafeAreaFallback()).toBe(false)
    setup('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', true, 915, 915)
    expect(needsSafeAreaFallback()).toBe(false)
  })
})
