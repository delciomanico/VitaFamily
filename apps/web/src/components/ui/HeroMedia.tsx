import { useState } from 'react'
import { cn } from '@/lib/cn'

interface HeroMediaProps {
  /** Fotografia mostrada enquanto o vídeo carrega, se não existir e com «reduzir animações». */
  poster: string
  /** Ficheiros em `public/`, por ordem de preferência. Sem ficheiros, fica só a fotografia. */
  sources?: { src: string; type: string }[]
  alt?: string
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
}

/**
 * Fundo do hero: vídeo em ciclo, sem som, por cima da fotografia. Se os ficheiros de vídeo não
 * existirem (ou falharem), ou o sistema pedir menos animação, fica a fotografia com um zoom lento.
 */
export function HeroMedia({ poster, sources = [], alt = '' }: HeroMediaProps) {
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const showVideo = sources.length > 0 && !failed && !prefersReducedMotion()

  return (
    <div aria-hidden={alt === '' ? true : undefined} className="absolute inset-0 -z-10 overflow-hidden bg-foreground">
      <img src={poster} alt={alt} className="size-full animate-login-slide object-cover" />
      {showVideo && (
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={poster}
          onLoadedData={() => setReady(true)}
          className={cn('absolute inset-0 size-full object-cover transition-opacity duration-1000', ready ? 'opacity-100' : 'opacity-0')}
        >
          {sources.map((source) => (
            <source key={source.src} src={source.src} type={source.type} onError={() => setFailed(true)} />
          ))}
        </video>
      )}
    </div>
  )
}
