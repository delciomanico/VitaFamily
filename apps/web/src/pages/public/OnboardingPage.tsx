import { useRef, useState, type TouchEvent } from 'react'
import { BellRing, HeartPulse, Users, type LucideIcon } from 'lucide-react'
import { Logo } from '@/components/layout/Logo'
import { Button, ButtonLink } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { preferences } from '@/lib/storage'
import { paths } from '@/routes/paths'

interface Slide {
  icon: LucideIcon
  lines: string[]
}

const slides: Slide[] = [
  { icon: HeartPulse, lines: ['Sua saúde,', 'num só lugar.'] },
  { icon: Users, lines: ['Cuide da saúde', 'de quem importa.'] },
  { icon: BellRing, lines: ['Acompanhe.', 'Lembre-se.', 'Previna.'] },
]

/** Distância mínima (px) de um gesto horizontal para mudar de tela. */
const SWIPE_THRESHOLD_PX = 50

export function OnboardingPage() {
  const [index, setIndex] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const lastIndex = slides.length - 1
  const isLast = index === lastIndex
  const slide = slides[index] ?? slides[0]!
  const Icon = slide.icon

  function goTo(next: number) {
    const clamped = Math.max(0, Math.min(next, lastIndex))
    if (clamped === lastIndex) preferences.markOnboardingSeen()
    setIndex(clamped)
  }

  function onTouchEnd(event: TouchEvent) {
    const start = touchStartX.current
    const end = event.changedTouches[0]?.clientX
    touchStartX.current = null
    if (start === null || end === undefined) return
    const delta = end - start
    if (Math.abs(delta) >= SWIPE_THRESHOLD_PX) goTo(index + (delta < 0 ? 1 : -1))
  }

  return (
    <div
      className="flex flex-1 flex-col"
      onTouchStart={(event) => (touchStartX.current = event.touches[0]?.clientX ?? null)}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex h-11 items-center justify-between">
        <Logo />
        {!isLast && (
          <Button variant="ghost" size="sm" onClick={() => goTo(lastIndex)}>
            Saltar
          </Button>
        )}
      </div>

      <section
        aria-roledescription="diapositivo"
        aria-label={`${index + 1} de ${slides.length}`}
        aria-live="polite"
        className="flex flex-1 flex-col items-center justify-center gap-10 py-10 text-center"
      >
        <span className="flex size-28 items-center justify-center rounded-full bg-primary-soft text-primary">
          <Icon className="size-12" strokeWidth={1.5} aria-hidden />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {slide.lines.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>
      </section>

      <div className="flex flex-col gap-6">
        <div className="flex justify-center gap-2">
          {slides.map((_, dot) => (
            <button
              key={dot}
              type="button"
              onClick={() => goTo(dot)}
              aria-label={`Ir para o passo ${dot + 1}`}
              aria-current={dot === index ? 'step' : undefined}
              className="flex size-6 items-center justify-center"
            >
              <span
                className={cn(
                  'h-2 rounded-full transition-all',
                  dot === index ? 'w-6 bg-primary' : 'w-2 bg-border-strong',
                )}
              />
            </button>
          ))}
        </div>

        {isLast ? (
          <div className="flex flex-col gap-2">
            <ButtonLink to={paths.register} size="lg" fullWidth>
              Criar conta
            </ButtonLink>
            <ButtonLink to={paths.login} size="lg" variant="ghost" fullWidth>
              Já tenho uma conta
            </ButtonLink>
          </div>
        ) : (
          <Button size="lg" fullWidth onClick={() => goTo(index + 1)}>
            Continuar
          </Button>
        )}
      </div>
    </div>
  )
}
