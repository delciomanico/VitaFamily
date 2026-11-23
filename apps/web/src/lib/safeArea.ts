/*
 * Margens de segurança em Android (PWA instalada em ecrã inteiro).
 * Sintoma: o Chrome desenha a app por baixo da barra de estado e da barra de navegação/gestos mas
 * `env(safe-area-inset-*)` vem a 0. Deteta: modo standalone + Android + inset 0 + janela com a altura do ecrã
 * (as barras não retiram espaço). Só então liga `html.safe-fallback` (ver `--safe-top/--safe-bottom`).
 * Nunca atua no navegador normal nem no iOS (onde env() funciona).
 */

function envInsetTop(): number {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)'
  document.body.appendChild(probe)
  const value = Number.parseFloat(getComputedStyle(probe).paddingTop) || 0
  probe.remove()
  return value
}

export function needsSafeAreaFallback(): boolean {
  if (typeof window === 'undefined' || !/Android/i.test(navigator.userAgent)) return false
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches
  if (!standalone) return false
  if (envInsetTop() > 0) return false
  // Sem sobreposição das barras, a janela é mais baixa do que o ecrã (barras de estado e navegação retiram espaço).
  return window.screen.height - window.innerHeight < 2
}

export function applySafeAreaFallback(): void {
  const update = () => document.documentElement.classList.toggle('safe-fallback', needsSafeAreaFallback())
  update()
  window.addEventListener('resize', update)
  window.addEventListener('orientationchange', update)
}
