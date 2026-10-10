import { useRef, useState, type TouchEvent } from 'react'
import { Button, ButtonLink } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { preferences } from '@/lib/storage'
import { paths } from '@/routes/paths'
import { OnboardingPreview, type PreviewKind } from './OnboardingPreview'

interface Slide {
  preview: PreviewKind
  title: string
  description: string
}

const slides: Slide[] = [
  {
    preview: 'health',
    title: 'A sua saúde, num só lugar',
    description: 'Perfil de saúde, receitas, exames e consultas organizados e sempre à mão.',
  },
  {
    preview: 'family',
    title: 'Cuide da saúde de quem importa',
    description: 'Acompanhe os membros da sua família e os dependentes ao seu cuidado.',
  },
  {
    preview: 'reminders',
    title: 'Acompanhe. Lembre-se. Previna.',
    description: 'Receba lembretes de tomas, consultas e exames na hora certa.',
  },
]

/** Distância mínima (px) de um gesto horizontal para mudar de tela. */
const SWIPE_THRESHOLD_PX = 50

export function OnboardingPage() {
  const [index, setIndex] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const lastIndex = slides.length - 1
  const isLast = index === lastIndex
  const slide = slides[index] ?? slides[0]!

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
      className={cn(
        'fixed inset-0 flex flex-col overflow-hidden bg-brand',
        'md:relative md:inset-auto md:mx-auto md:my-10 md:h-[min(46rem,calc(100dvh-5rem))] md:w-full md:max-w-md md:rounded-3xl md:shadow-overlay',
      )}
      onTouchStart={(event) => (touchStartX.current = event.touches[0]?.clientX ?? null)}
      onTouchEnd={onTouchEnd}
    >
      <div className="relative min-h-0 flex-1 pt-safe">
        <div className="absolute inset-x-0 top-[max(2.5rem,env(safe-area-inset-top))] bottom-0 flex justify-center">
          <div className="aspect-[9/16] h-[calc(100%+3rem)] max-w-[72%]">
            <OnboardingPreview kind={slide.preview} />
          </div>
        </div>
      </div>

      <section
        aria-roledescription="diapositivo"
        aria-label={`${index + 1} de ${slides.length}`}
        aria-live="polite"
        className="relative flex shrink-0 flex-col gap-5 bg-surface px-6 pt-10 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center"
        style={{ borderRadius: '50% 50% 0 0 / 2.5rem 2.5rem 0 0' }}
      >
        <div className="flex flex-col gap-2.5">
          <h1 className="text-[1.625rem] leading-tight font-bold tracking-tight text-balance">{slide.title}</h1>
          <p className="text-muted text-balance">{slide.description}</p>
        </div>

        <div className="flex justify-center gap-1">
          {slides.map((_, dot) => (
            <button
              key={dot}
              type="button"
              onClick={() => goTo(dot)}
              aria-label={`Ir para o passo ${dot + 1}`}
              aria-current={dot === index ? 'step' : undefined}
              className="flex h-6 items-center justify-center px-0.5"
            >
              <span
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  dot === index ? 'w-6 bg-primary' : 'w-1.5 bg-border-strong',
                )}
              />
            </button>
          ))}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-3">
          {isLast ? (
            <>
              <ButtonLink to={paths.login} size="lg" variant="soft">
                Entrar
              </ButtonLink>
              <ButtonLink to={paths.register} size="lg">
                Criar conta
              </ButtonLink>
            </>
          ) : (
            <>
              <Button size="lg" variant="soft" onClick={() => goTo(lastIndex)}>
                Saltar
              </Button>
              <Button size="lg" onClick={() => goTo(index + 1)}>
                Continuar
              </Button>
            </>
          )}
        </div>
      </section>
    </div>
  )
}
