import { useEffect, useState } from 'react'
import { BrandLoader } from './BrandLoader'

const SEEN_KEY = 'vf.boot.seen'
const SHOW_MS = 2100
const FADE_MS = 500

function alreadySeen(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === '1'
  } catch {
    return false
  }
}

function shouldShow(): boolean {
  if (import.meta.env.MODE === 'test') return false
  if (alreadySeen()) return false
  // Quem pediu menos animação não espera por uma introdução.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
  // A app instalada já tem o seu splash.
  if (window.matchMedia?.('(display-mode: standalone)').matches) return false
  return true
}

/**
 * Introdução da marca na primeira abertura de cada sessão do browser: o carregamento animado do
 * Vita Family por cima da app, que depois se esvanece. Não bloqueia nada: a app carrega por baixo.
 */
export function BootSplash() {
  const [phase, setPhase] = useState<'show' | 'fade' | 'gone'>(() => (shouldShow() ? 'show' : 'gone'))

  useEffect(() => {
    if (phase === 'gone') return
    try {
      window.sessionStorage.setItem(SEEN_KEY, '1')
    } catch {
      // Sem armazenamento (modo privado): a introdução repete-se, sem problema.
    }
    // Sem scroll da página por trás enquanto a introdução está visível.
    const root = document.documentElement
    const previousOverflow = root.style.overflow
    root.style.overflow = 'hidden'
    const toFade = window.setTimeout(() => setPhase('fade'), SHOW_MS)
    const toGone = window.setTimeout(() => {
      root.style.overflow = previousOverflow
      setPhase('gone')
    }, SHOW_MS + FADE_MS)
    return () => {
      window.clearTimeout(toFade)
      window.clearTimeout(toGone)
      root.style.overflow = previousOverflow
    }
    // Só corre ao montar: o estado inicial decide se há introdução.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'gone') return null
  return (
    <div
      aria-hidden
      style={{ transitionDuration: `${FADE_MS}ms` }}
      className={`fixed inset-0 z-[100] bg-surface transition-opacity ease-in-out ${phase === 'fade' ? 'opacity-0' : 'opacity-100'}`}
    >
      <BrandLoader />
    </div>
  )
}
