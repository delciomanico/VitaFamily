import { Component, type ErrorInfo, type ReactNode } from 'react'
import { CircleAlert } from 'lucide-react'
import { Button } from './Button'

interface ErrorBoundaryProps {
  children: ReactNode
  /** `inline`: um cartão discreto no lugar do bloco que falhou (itens de lista); `page`: ecrã completo. */
  variant?: 'inline' | 'page'
  /** Muda de valor (ex.: rota ou id) para repor o boundary depois de uma falha. */
  resetKey?: string | number
}

interface ErrorBoundaryState {
  failed: boolean
}

/**
 * Impede que um dado inesperado vindo da API (ou um bug de renderização) deixe a app em branco:
 * só o bloco afetado é substituído por um aviso, com “Tentar novamente”.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Sem PII: só o erro técnico e a pilha de componentes.
    console.error('UI error', error, info.componentStack)
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <ErrorFallback variant={this.props.variant ?? 'inline'} onRetry={() => this.setState({ failed: false })} />
    )
  }
}

interface ErrorFallbackProps {
  variant: 'inline' | 'page'
  onRetry?: () => void
}

export function ErrorFallback({ variant, onRetry }: ErrorFallbackProps) {
  if (variant === 'inline') {
    return (
      <div role="alert" className="flex items-center gap-2 py-3 text-sm text-muted">
        <CircleAlert className="size-4 shrink-0" aria-hidden />
        <span className="flex-1">Não foi possível mostrar este item.</span>
        {onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Tentar novamente
          </Button>
        )}
      </div>
    )
  }
  return (
    <div role="alert" className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-surface-muted text-muted">
        <CircleAlert className="size-7" aria-hidden />
      </span>
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">Algo correu mal</h1>
        <p className="text-sm text-muted">
          Não foi possível mostrar esta página. Os seus dados estão seguros. Tente novamente ou volte ao início.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => window.location.reload()}>Recarregar</Button>
        <Button variant="secondary" onClick={() => window.location.assign('/')}>
          Ir para o início
        </Button>
      </div>
    </div>
  )
}
