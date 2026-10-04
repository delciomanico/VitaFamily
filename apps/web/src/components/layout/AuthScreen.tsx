import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/cn'

interface AuthScreenProps {
  title: string
  description?: ReactNode
  /** Destino da seta de voltar. */
  backTo?: string
  /** Progresso da configuração inicial (barra no topo, “1/3”). */
  progress?: { step: number; total: number }
  /** Conteúdo acima do título (ex.: símbolo). */
  leading?: ReactNode
  children: ReactNode
}

/**
 * Tela de autenticação e configuração inicial: seta de voltar e progresso no topo,
 * título grande alinhado à esquerda e conteúdo em coluna. As ações principais vão
 * em `AuthFooter`, encostadas ao fundo do ecrã no mobile.
 */
export function AuthScreen({ title, description, backTo, progress, leading, children }: AuthScreenProps) {
  const hasTopBar = Boolean(backTo || progress)

  return (
    <div
      className={cn(
        'mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-safe pb-[max(1.25rem,env(safe-area-inset-bottom))]',
        'md:my-10 md:min-h-[min(46rem,calc(100dvh-5rem))] md:rounded-3xl md:bg-surface md:px-8 md:py-6 md:shadow-overlay',
      )}
    >
      {hasTopBar ? (
        <div className="flex h-14 shrink-0 items-center gap-3">
          {backTo && (
            <Link
              to={backTo}
              aria-label="Voltar"
              className="-ml-2.5 flex size-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors hover:bg-surface-muted"
            >
              <ArrowLeft className="size-5" aria-hidden />
            </Link>
          )}
          {progress && <ProgressBar {...progress} />}
        </div>
      ) : (
        <div className="h-8 shrink-0 md:h-4" />
      )}

      <div className="flex flex-col gap-2 pt-2 pb-7">
        {leading}
        <h1 className="text-[1.625rem] leading-tight font-bold tracking-tight">{title}</h1>
        {description && <p className="text-muted">{description}</p>}
      </div>

      <div className="flex flex-1 flex-col">{children}</div>
    </div>
  )
}

function ProgressBar({ step, total }: { step: number; total: number }) {
  const percent = Math.round((step / total) * 100)
  return (
    <>
      <div
        role="progressbar"
        aria-label="Progresso da configuração"
        aria-valuemin={1}
        aria-valuemax={total}
        aria-valuenow={step}
        aria-valuetext={`Passo ${step} de ${total}`}
        className="mx-auto h-2 w-full max-w-48 overflow-hidden rounded-full bg-surface-muted"
      >
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <span className="shrink-0 text-sm font-semibold tabular-nums" aria-hidden>
        {step} / {total}
      </span>
    </>
  )
}

/** Ações no fundo da tela (botão principal e ligações secundárias). */
export function AuthFooter({ children }: { children: ReactNode }) {
  return <div className="mt-auto flex flex-col gap-4 pt-8">{children}</div>
}

/** Frase com ligação, ex.: “Já tem conta? Entrar”. */
export function AuthSwitch({ text, to, label }: { text: string; to: string; label: string }) {
  return (
    <p className="text-center text-sm text-muted">
      {text}{' '}
      <Link to={to} className="font-semibold text-primary hover:underline">
        {label}
      </Link>
    </p>
  )
}
