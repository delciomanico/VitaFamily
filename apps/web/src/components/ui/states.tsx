import { BrandLoader } from './BrandLoader'
import type { ReactNode } from 'react'
import { CircleAlert, type LucideIcon } from 'lucide-react'
import { Button } from './Button'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description?: string
  /** Próximo passo sugerido (ex.: “Adicionar receita”). */
  action?: ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl bg-surface px-6 py-10 text-center shadow-card">
      <span className="relative flex size-28 items-center justify-center" aria-hidden>
        <svg viewBox="0 0 120 120" className="absolute inset-0 text-sun-soft">
          <path d="M60 6c22 0 46 12 52 36s-6 48-28 62-52 10-66-12S-2 52 14 30 38 6 60 6Z" fill="currentColor" />
          <circle cx="104" cy="22" r="5" fill="var(--color-sun)" />
          <circle cx="14" cy="96" r="3.5" fill="var(--color-accent)" />
        </svg>
        <span className="relative flex size-16 -rotate-6 items-center justify-center rounded-2xl bg-surface text-primary shadow-card">
          <Icon className="size-8" strokeWidth={1.8} />
        </span>
      </span>
      <div className="flex max-w-[20rem] flex-col gap-1">
        <p className="font-display text-xl font-bold">{title}</p>
        {description && <p className="text-base text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

interface LoadingStateProps {
  /** Número de linhas de esqueleto. */
  rows?: number
  label?: string
}

export function LoadingState({ rows = 3, label = 'A carregar…' }: LoadingStateProps) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-20 animate-pulse rounded-lg bg-surface-muted" aria-hidden />
      ))}
    </div>
  )
}

/** Carregamento de ecrã inteiro (ex.: enquanto a sessão é restaurada): a animação da marca. */
export function FullScreenLoader({ label = 'A carregar…' }: { label?: string }) {
  return <BrandLoader label={label} />
}

/** Mensagem de erro de um formulário (ex.: credenciais inválidas). */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-soft px-3.5 py-3 text-sm text-danger">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {message}
    </p>
  )
}

interface ErrorStateProps {
  message?: string
  onRetry?: () => void
}

export function ErrorState({
  message = 'Não foi possível carregar os dados. Tente novamente.',
  onRetry,
}: ErrorStateProps) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-lg bg-danger-soft px-6 py-8 text-center">
      <CircleAlert className="size-6 text-danger" aria-hidden />
      <p className="text-sm text-foreground">{message}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  )
}
