import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

/** Fotos do fundo do login (fornecidas pelo proprietário). Para mais slides, juntar ficheiros aqui. */
export const LOGIN_SLIDES = ['/images/login/familia.webp', '/images/login/consulta.webp']

/** Tempo de cada foto no ecrã. */
const SLIDE_INTERVAL_MS = 6000

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Fundo decorativo do login: fotos desfocadas que se sucedem com fade e um zoom lento,
 * sob um véu escuro que garante o contraste do texto branco. Sem movimento se o
 * utilizador pedir menos animações.
 */
export function LoginBackground() {
  // -1 no primeiro render: a primeira foto também entra com fade.
  const [active, setActive] = useState(-1)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setActive(0))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (LOGIN_SLIDES.length < 2 || prefersReducedMotion()) return
    const timer = window.setInterval(() => setActive((i) => (i + 1) % LOGIN_SLIDES.length), SLIDE_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden bg-brand">
      {LOGIN_SLIDES.map((src, index) => (
        <img
          key={src}
          src={src}
          alt=""
          onError={(event) => event.currentTarget.remove()}
          className={cn(
            'absolute inset-0 size-full object-cover blur-[6px]',
            '[transition:opacity_1.6s_ease-in-out,transform_9s_ease-out]',
            index === active ? 'scale-[1.22] opacity-100' : 'scale-110 opacity-0',
          )}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-b from-brand/50 via-foreground/45 to-foreground/75" />
    </div>
  )
}
