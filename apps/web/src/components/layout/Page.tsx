import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { MenuButton } from './MenuButton'

interface PageProps {
  title: string
  /** Texto de apoio, mostrado por baixo da faixa. */
  description?: string
  /** Destino do botão voltar (páginas de detalhe). */
  backTo?: string
  backLabel?: string
  /** Ação principal, logo abaixo da faixa (ex.: “Editar perfil”); a faixa fica só com título e menu. */
  action?: ReactNode
  /** Substitui o título (ex.: saudação da Home). */
  header?: ReactNode
  /** Ecrã fixo à altura da janela, sem scroll vertical (Home). */
  fullScreen?: boolean
  children: ReactNode
}

/** Título da faixa: 24px, tamanho mínimo para texto branco sobre a cor da faixa (contraste AA texto grande). */
export const bandTitleClass = 'truncate text-2xl leading-tight font-semibold tracking-tight'

/**
 * Página da área autenticada: faixa ciano compacta numa só linha (voltar, título, menu),
 * seguida do conteúdo centrado.
 */
export function Page({
  title,
  description,
  backTo,
  backLabel = 'Voltar',
  action,
  header,
  fullScreen = false,
  children,
}: PageProps) {
  return (
    <div className={cn(fullScreen && 'flex h-dvh flex-col overflow-hidden')}>
      <header className="shrink-0 bg-brand pt-safe text-white">
        <div className="mx-auto flex h-16 max-w-3xl items-center gap-2 px-4 lg:px-8">
          {backTo && (
            <Link
              to={backTo}
              aria-label={backLabel}
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15"
            >
              <ChevronLeft className="size-6" aria-hidden />
            </Link>
          )}
          <div className="min-w-0 flex-1">{header ?? <h1 className={bandTitleClass}>{title}</h1>}</div>
          <MenuButton />
        </div>
      </header>
      <div
        className={cn(
          'mx-auto flex w-full max-w-3xl flex-col px-4 lg:px-8',
          fullScreen
            ? 'min-h-0 flex-1 gap-3 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]'
            : 'gap-6 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] lg:pb-12',
        )}
      >
        {(description || action) && (
          <div className="flex items-center justify-between gap-4">
            {description ? <p className="text-muted">{description}</p> : <span />}
            {action}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
