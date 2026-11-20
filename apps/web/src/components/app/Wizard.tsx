import type { FormEvent, ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { FormError } from '@/components/ui/states'

interface WizardProps {
  /** Nome da tarefa (ex.: «Completar o perfil»). */
  title: string
  /** Assunto deste passo (um por ecrã). */
  stepTitle: string
  description?: string
  /** Passo atual, a partir de 0. */
  step: number
  total: number
  /** Passo anterior; no primeiro passo, sai do assistente. */
  onBack: () => void
  /** «Continuar» (ou o texto final) — também com Enter. */
  onNext: () => void | Promise<void>
  nextLabel?: string
  nextDisabled?: boolean
  busy?: boolean
  error?: string | null
  children: ReactNode
}

/**
 * Passo a passo: um assunto por ecrã, progresso visível, «Voltar» sempre disponível e um único botão grande em baixo.
 * O estado dos campos vive na página (rascunho), por isso voltar atrás nunca apaga o que foi escrito.
 */
export function Wizard({ title, stepTitle, description, step, total, onBack, onNext, nextLabel = 'Continuar', nextDisabled = false, busy = false, error = null, children }: WizardProps) {
  const current = step + 1
  const percent = Math.round((current / total) * 100)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!busy && !nextDisabled) void onNext()
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-1 flex-col gap-5">
      <header className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="-ms-2 inline-flex min-h-12 items-center gap-1 rounded-full pe-4 ps-1 text-base font-medium text-primary hover:bg-primary-soft"
          >
            <ChevronLeft className="size-6" aria-hidden />
            Voltar
          </button>
          <p className="text-base font-medium text-muted" aria-hidden>
            Passo {current} de {total}
          </p>
        </div>
        <div
          role="progressbar"
          aria-label={`${title}: progresso`}
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={current}
          aria-valuetext={`Passo ${current} de ${total}`}
          className="h-2.5 w-full overflow-hidden rounded-full bg-surface-muted"
        >
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-base font-medium text-muted">{title}</p>
      </header>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold text-balance">{stepTitle}</h1>
        {description && <p className="text-base text-muted">{description}</p>}
      </div>

      <div className="flex flex-col gap-5">{children}</div>

      <div className="sticky bottom-0 -mx-5 mt-auto flex flex-col gap-3 border-t border-border bg-background px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <FormError message={error} />
        <Button type="submit" size="xl" fullWidth loading={busy} disabled={nextDisabled}>
          {nextLabel}
        </Button>
      </div>
    </form>
  )
}
