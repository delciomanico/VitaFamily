import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/** Fotos do fundo do login (fornecidas pelo proprietário). Para mais slides, juntar ficheiros aqui. */
export const LOGIN_SLIDES = ['/images/login/familia.webp', '/images/login/consulta.webp']

/** Tempo de cada foto no ecrã. */
const SLIDE_INTERVAL_MS = 6000
/** Duração do fade de entrada; tem de corresponder ao keyframe `login-slide` (20% de 8s). */
const FADE_MS = 1600

interface SlideState {
  active: number
  /** Foto anterior: fica opaca por baixo até a nova a cobrir por completo. */
  previous: number | null
}

/**
 * Fundo decorativo do login: fotos desfocadas que se sucedem com fade e um zoom lento,
 * sob um véu escuro que garante o contraste do texto branco.
 *
 * A troca não cruza opacidades (isso deixava ver o fundo a meio): a foto nova entra por
 * cima com fade enquanto a anterior continua opaca e com o seu zoom; só depois é escondida.
 * Com menos animações pedidas pelo sistema, as fotos não alternam.
 */
export function LoginBackground() {
  const [{ active, previous }, setSlides] = useState<SlideState>({ active: 0, previous: null })

  useEffect(() => {
    if (LOGIN_SLIDES.length < 2 || prefersReducedMotion()) return
    let clearTimer: number | undefined
    const timer = window.setInterval(() => {
      setSlides(({ active: current }) => ({ active: (current + 1) % LOGIN_SLIDES.length, previous: current }))
      clearTimer = window.setTimeout(() => setSlides((s) => ({ ...s, previous: null })), FADE_MS)
    }, SLIDE_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(clearTimer)
    }
  }, [])

  return (
    // `isolate`: os z-index das fotos ficam contidos aqui e não passam por cima do formulário.
    <div aria-hidden className="absolute inset-0 isolate overflow-hidden bg-brand">
      {LOGIN_SLIDES.map((src, index) => (
        <img
          key={src}
          src={src}
          alt=""
          decoding="async"
          onError={(event) => event.currentTarget.remove()}
          className={cn(
            'absolute inset-0 size-full object-cover blur-[6px] will-change-[opacity,transform]',
            index === active && 'z-20 animate-login-slide',
            // Mantém a mesma animação (não reinicia): continua opaca e com o zoom onde estava.
            index === previous && 'z-10 animate-login-slide',
            index !== active && index !== previous && 'opacity-0',
          )}
        />
      ))}
      <div className="absolute inset-0 z-30 bg-gradient-to-b from-brand/50 via-foreground/45 to-foreground/75" />
    </div>
  )
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
