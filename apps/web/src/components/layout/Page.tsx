import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
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
  /** Como abrir o menu: ícone (padrão) ou avatar (Home). */
  menu?: 'icon' | 'avatar'
  children: ReactNode
}

/**
 * Página da área autenticada: faixa ciano numa só linha (voltar, título, menu),
 * seguida do conteúdo centrado.
 */
export function Page({ title, description, backTo, backLabel = 'Voltar', action, header, menu = 'icon', children }: PageProps) {
  return (
    <>
      <header className="bg-brand pt-safe text-white">
        <div className="mx-auto flex min-h-28 max-w-3xl items-center gap-3 px-4 py-5 lg:min-h-32 lg:px-8">
          {backTo && (
            <Link
              to={backTo}
              aria-label={backLabel}
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15"
            >
              <ChevronLeft className="size-7" aria-hidden />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            {header ?? <h1 className="truncate text-[1.75rem] leading-tight font-semibold tracking-tight">{title}</h1>}
          </div>
          <MenuButton variant={menu} />
        </div>
      </header>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] lg:px-8 lg:pb-12">
        {(description || action) && (
          <div className="flex items-center justify-between gap-4">
            {description ? <p className="text-muted">{description}</p> : <span />}
            {action}
          </div>
        )}
        {children}
      </div>
    </>
  )
}
