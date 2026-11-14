import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'

interface HeroMediaProps {
  /** Fotografias do carrossel (a primeira é a de arranque). */
  images: { src: string; alt?: string }[]
  /** Ficheiros de vídeo em `public/`, por ordem de preferência. Sem ficheiros, só o carrossel. */
  sources?: { src: string; type: string }[]
}

/** Tempo de cada foto e duração do fade cruzado. */
const INTERVAL_MS = 7000
const FADE_MS = 1600

function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

interface SlideState {
  active: number
  /** Foto que sai: continua visível e a mexer-se enquanto a nova entra em fade. */
  previous: number | null
  /** Nº de trocas; a paridade alterna entre zoom in e zoom out. */
  cycle: number
}

/**
 * Fundo do hero. Fotografias em carrossel com fade cruzado, cada uma com um zoom lento que
 * alterna entre aproximar (zoom in) e afastar (zoom out). Se existir vídeo, entra por cima em
 * fade e passa a ser o fundo; se faltar ou falhar, o carrossel continua. Com «reduzir animações»
 * fica uma fotografia parada.
 */
export function HeroMedia({ images, sources = [] }: HeroMediaProps) {
  const [{ active, previous, cycle }, setSlides] = useState<SlideState>({ active: 0, previous: null, cycle: 0 })
  const [videoReady, setVideoReady] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const reduced = prefersReducedMotion()
  const showVideo = sources.length > 0 && !videoFailed && !reduced

  useEffect(() => {
    if (images.length < 2 || reduced || (showVideo && videoReady)) return
    let clearTimer: number | undefined
    const timer = window.setInterval(() => {
      setSlides((s) => ({ active: (s.active + 1) % images.length, previous: s.active, cycle: s.cycle + 1 }))
      clearTimer = window.setTimeout(() => setSlides((s) => ({ ...s, previous: null })), FADE_MS)
    }, INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(clearTimer)
    }
  }, [images.length, reduced, showVideo, videoReady])

  /** Direção do zoom de cada foto: a ativa depende do ciclo; a que sai manteve a anterior. */
  function motion(index: number): string | undefined {
    if (reduced) return undefined
    if (index === active) return cycle % 2 === 0 ? 'animate-kb-in' : 'animate-kb-out'
    if (index === previous) return (cycle - 1) % 2 === 0 ? 'animate-kb-in' : 'animate-kb-out'
    return undefined
  }

  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden bg-foreground">
      {images.map((image, index) => (
        <img
          key={image.src}
          src={image.src}
          alt=""
          decoding="async"
          style={{ transitionDuration: `${FADE_MS}ms` }}
          className={cn(
            'absolute inset-0 size-full object-cover transition-opacity ease-in-out',
            index === active ? 'z-10 opacity-100' : index === previous ? 'z-0 opacity-100' : 'z-0 opacity-0',
            motion(index),
          )}
        />
      ))}
      {showVideo && (
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          onLoadedData={() => setVideoReady(true)}
          className={cn(
            'absolute inset-0 z-20 size-full object-cover transition-opacity duration-1000',
            videoReady ? 'opacity-100' : 'opacity-0',
          )}
        >
          {sources.map((source) => (
            <source key={source.src} src={source.src} type={source.type} onError={() => setVideoFailed(true)} />
          ))}
        </video>
      )}
    </div>
  )
}
