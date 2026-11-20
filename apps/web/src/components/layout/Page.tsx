import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useBackTo } from '@/hooks/useBackTo'
import { HeroBand } from '@/components/app/Sunrise'
import { LogoMark } from './Logo'
import { AlertsButton } from './AlertsButton'

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
  /** Início: faixa alta com saudação (`hero`) e o sol a nascer (`sun`), em vez da faixa compacta. */
  hero?: ReactNode
  sun?: ReactNode
  /** Ecrã fixo à altura da janela, sem scroll vertical (Home). */
  fullScreen?: boolean
  children: ReactNode
}

/**
 * Título da faixa: 19px em negrito — discreto, mas ainda “texto grande” (≥ 18.66px bold),
 * o mínimo para branco sobre a cor da faixa cumprir o contraste AA.
 */
export const bandTitleClass = 'truncate font-display text-[1.375rem] leading-tight font-bold tracking-tight'

/**
 * Página da área autenticada: faixa ciano compacta numa só linha (voltar, título, alertas),
 * seguida do conteúdo centrado. A navegação está na barra inferior (BottomNav).
 */
export function Page({
  title,
  description,
  backTo,
  backLabel = 'Voltar',
  action,
  header,
  hero,
  sun,
  fullScreen = false,
  children,
}: PageProps) {
  const handleBack = useBackTo(backTo ?? '/')
  return (
    <div className={cn(fullScreen && 'flex h-[calc(100dvh-var(--bottom-nav-h,0px))] flex-col overflow-hidden')}>
      {hero ? (
        <header className="shrink-0">
          <HeroBand sun={sun} className="pt-safe">
            <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-2 px-4 lg:px-8">
              <LogoMark tone="inverse" className="size-9" />
              <AlertsButton />
            </div>
            <div className="mx-auto max-w-3xl px-4 pt-3 lg:px-8"><div className={sun ? 'pr-24' : undefined}>{hero}</div></div>
          </HeroBand>
        </header>
      ) : (
      <header className="shrink-0 rounded-b-3xl bg-brand-deep pt-safe text-white">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-4 lg:px-8">
          {backTo && (
            <Link
              to={backTo}
              onClick={handleBack}
              aria-label={backLabel}
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/15"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </Link>
          )}
          <div className="min-w-0 flex-1">{header ?? <h1 className={bandTitleClass}>{title}</h1>}</div>
          <AlertsButton />
        </div>
      </header>
      )}
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
