import { cn } from '@/lib/cn'

const NAME = 'Vita Family'

interface BrandLoaderProps {
  /** Texto para leitores de ecrã. */
  label?: string
  className?: string
}

/**
 * Carregamento da marca: o símbolo constrói-se (folha, lóbulo e depois o batimento a desenhar-se
 * pelo coração), passa a «bater» em ciclo e o nome surge letra a letra com uma luz a deslizar por
 * baixo. Com «reduzir animações», fica o símbolo e o nome parados.
 */
export function BrandLoader({ label = 'A carregar…', className }: BrandLoaderProps) {
  return (
    <div role="status" className={cn('flex min-h-dvh flex-col items-center justify-center gap-7 bg-surface', className)}>
      <svg viewBox="0 0 512 512" aria-hidden className="size-28 animate-vf-beat overflow-visible md:size-32 [transform-box:fill-box] [transform-origin:center]">
        <path
          className="animate-vf-leaf [transform-box:fill-box] [transform-origin:bottom_right]"
          d="M246 432C150 384 90 304 100 228C108 160 160 112 214 80C252 150 274 222 268 292C264 350 256 396 246 432Z"
          fill="var(--color-accent)"
        />
        <path
          className="animate-vf-lobe [transform-box:fill-box] [transform-origin:bottom_left]"
          d="M268 430C280 384 286 334 286 290C288 236 284 198 276 170C304 140 346 126 382 134C430 146 448 196 438 246C424 318 354 382 268 430Z"
          fill="var(--color-primary)"
        />
        <path
          className="animate-vf-line"
          d="M60 290H452"
          pathLength={1}
          strokeDasharray={1}
          fill="none"
          stroke="var(--color-brand)"
          strokeWidth={22}
          strokeLinecap="round"
        />
        <path
          className="animate-vf-line"
          d="M124 290H178L208 234L242 350L282 202L316 290H424"
          pathLength={1}
          strokeDasharray={1}
          fill="none"
          stroke="#fff"
          strokeWidth={22}
          strokeLinejoin="round"
        />
      </svg>

      <div className="flex flex-col items-center gap-5">
        <p aria-hidden className="flex text-3xl font-bold tracking-tight text-foreground md:text-4xl">
          {[...NAME].map((char, index) => (
            <span
              key={index}
              style={{ animationDelay: `${900 + index * 60}ms` }}
              className="animate-vf-letter inline-block whitespace-pre"
            >
              {char}
            </span>
          ))}
        </p>
        <span aria-hidden className="relative h-1 w-32 overflow-hidden rounded-full bg-primary-soft">
          <span className="absolute inset-y-0 left-0 w-1/3 animate-vf-sweep rounded-full bg-primary" />
        </span>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  )
}
