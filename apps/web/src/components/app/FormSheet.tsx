import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { ConfirmSheet, Sheet } from '@/components/app/Sheet'
import { Wizard } from '@/components/app/Wizard'
import { Button } from '@/components/ui/Button'
import { FormError, LoadingState } from '@/components/ui/states'
import { cn } from '@/lib/cn'

interface FrameProps {
  /** Nome acessível da folha. */
  label: string
  /** Ocupa o ecrã todo (passo a passo) em vez de uma folha colada ao fundo. */
  full?: boolean
  /** Há dados por guardar: fechar pede confirmação antes de descartar. */
  dirty: boolean
  /** Fecha a folha (navega para o ecrã de baixo). */
  onClose: () => void
  /** Chamado ao confirmar «Sim, descartar» (ex.: apagar o rascunho), antes de fechar. */
  onDiscard?: () => void
  /** Foca o primeiro campo ao abrir (formulário curto «pronto a preencher»). */
  focusFirstField?: boolean
  /** Folha alta (92 % do ecrã) para formulários com listas de escolha. */
  tall?: boolean
  children: (requestClose: () => void) => ReactNode
}

/**
 * Moldura comum das folhas de formulário: <dialog> nativo (foco preso e devolvido a quem a abriu), Esc e toque fora
 * fecham, e com dados por guardar pergunta «Descartar alterações?» numa folha de confirmação.
 */
function SheetFrame({ label, full = false, tall = false, dirty, onClose, onDiscard, focusFirstField = false, children }: FrameProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const [confirming, setConfirming] = useState(false)

  useLayoutEffect(() => {
    const dialog = ref.current
    const opener = document.activeElement as HTMLElement | null
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      // O <dialog> sai do DOM com a rota: devolve o foco a quem o abriu.
      if (opener && opener.isConnected) opener.focus({ preventScroll: true })
    }
  }, [])

  useEffect(() => {
    if (!focusFirstField) return
    const field = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea:not([disabled]), select:not([disabled])')
    field?.focus({ preventScroll: true })
  }, [focusFirstField])

  const requestClose = useCallback(() => {
    if (dirty) setConfirming(true)
    else onClose()
  }, [dirty, onClose])

  return (
    <>
      <dialog
        ref={ref}
        aria-label={label}
        onCancel={(event) => {
          event.preventDefault()
          requestClose()
        }}
        onClick={(event) => event.target === ref.current && requestClose()}
        className={cn(
          'mx-auto mt-auto mb-0 w-full max-w-[34rem] animate-sheet-in flex-col p-0 text-foreground shadow-overlay open:flex',
          full ? 'h-dvh max-h-none rounded-none bg-background' : cn('max-h-[92dvh] rounded-t-[2rem] bg-surface', tall && 'h-[92dvh]'),
        )}
      >
        <div className="app-mobile flex min-h-0 flex-1 flex-col">{children(requestClose)}</div>
      </dialog>
      <ConfirmSheet
        open={confirming}
        title="Descartar alterações?"
        description="O que escreveu ainda não foi guardado."
        yesLabel="Sim, descartar"
        noLabel="Não, continuar a escrever"
        destructive
        onYes={() => {
          setConfirming(false)
          onDiscard?.()
          onClose()
        }}
        onNo={() => setConfirming(false)}
      />
    </>
  )
}

interface FormSheetProps {
  title: string
  description?: string
  /** Fecha a folha (volta ao ecrã de baixo). */
  onClose: () => void
  onDiscard?: () => void
  /** Há alterações por guardar. */
  dirty?: boolean
  /** Guardar: normalmente `handleSubmit(...)` do react-hook-form ou uma função própria. */
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>
  submitLabel?: string
  busy?: boolean
  submitDisabled?: boolean
  error?: string | null
  tall?: boolean
  children: ReactNode
}

/**
 * Formulário curto (até 5 campos) numa folha inferior: título e «Fechar» em cima, campos com scroll no meio e o botão
 * principal sempre visível em baixo (acima do teclado: altura em `dvh` e margem de segurança).
 */
export function FormSheet({ title, description, onClose, onDiscard, dirty = false, onSubmit, submitLabel = 'Guardar', busy = false, submitDisabled = false, error = null, tall = false, children }: FormSheetProps) {
  const titleId = useId()
  return (
    <SheetFrame label={title} dirty={dirty} onClose={onClose} onDiscard={onDiscard} focusFirstField tall={tall}>
      {(requestClose) => (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!busy) void onSubmit(event)
          }}
          noValidate
          aria-labelledby={titleId}
          className="flex min-h-0 flex-1 flex-col"
        >
          <header className="flex shrink-0 flex-col gap-2 px-5 pt-3 pb-2">
            <span className="mx-auto h-1.5 w-12 rounded-full bg-border-strong/80" aria-hidden />
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 id={titleId} className="text-[1.375rem] leading-tight font-bold text-balance">
                  {title}
                </h2>
                {description && <p className="text-base text-muted">{description}</p>}
              </div>
              <button type="button" onClick={requestClose} aria-label="Fechar" className="-me-2 flex size-12 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-muted">
                <X className="size-6" aria-hidden />
              </button>
            </div>
          </header>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-2">{children}</div>
          <footer className="flex shrink-0 flex-col gap-3 border-t border-border px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <FormError message={error} />
            <Button type="submit" size="xl" fullWidth loading={busy} disabled={submitDisabled}>
              {submitLabel}
            </Button>
          </footer>
        </form>
      )}
    </SheetFrame>
  )
}

type WizardProps = Parameters<typeof Wizard>[0]

interface WizardSheetProps extends Omit<WizardProps, 'onBack'> {
  /** Passo anterior (só chamado a partir do 2.º passo); no 1.º, «Voltar» fecha a folha. */
  onBack: () => void
  onClose: () => void
  onDiscard?: () => void
  dirty?: boolean
}

/** Formulário longo: folha em ecrã inteiro com o passo a passo (`Wizard`) lá dentro; «Voltar» no 1.º passo fecha. */
export function WizardSheet({ onClose, onDiscard, dirty = false, onBack, ...wizard }: WizardSheetProps) {
  return (
    <SheetFrame label={wizard.title} full dirty={dirty} onClose={onClose} onDiscard={onDiscard}>
      {(requestClose) => (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-[max(1rem,env(safe-area-inset-top))]">
          <Wizard {...wizard} onBack={wizard.step === 0 ? requestClose : onBack} />
        </div>
      )}
    </SheetFrame>
  )
}

interface SheetWaitProps {
  title: string
  onClose: () => void
  /** Falhou a preparação do formulário (ex.: carregar os membros): mostra «Tentar de novo». */
  onRetry?: () => void
  failed?: boolean
}

/** Folha provisória enquanto o formulário espera pelos dados de que precisa (ou se não os conseguiu obter). */
export function SheetWait({ title, onClose, onRetry, failed = false }: SheetWaitProps) {
  return (
    <Sheet
      open
      onClose={onClose}
      title={title}
      footer={
        failed && onRetry ? (
          <Button size="xl" fullWidth onClick={onRetry}>
            Tentar de novo
          </Button>
        ) : undefined
      }
    >
      {failed ? <p className="text-base text-muted">Não foi possível abrir este formulário. Verifique a ligação e tente de novo.</p> : <LoadingState rows={3} />}
    </Sheet>
  )
}
