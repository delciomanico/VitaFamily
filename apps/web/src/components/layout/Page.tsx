import { createContext, useContext, type ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { Bell, ChevronLeft, Settings } from 'lucide-react'
import { cn } from '@/lib/cn'
import { paths } from '@/routes/paths'
import { LogoMark } from './Logo'

/** Alertas por ler, fornecidos pelo AppShell à faixa de cada página. */
export const UnreadAlertsContext = createContext(0)

const bandIcon =
  'relative flex size-11 items-center justify-center rounded-full text-primary-foreground transition-colors hover:bg-white/15'

function TopRow({ backTo, backLabel }: { backTo?: string; backLabel: string }) {
  const unread = useContext(UnreadAlertsContext)
  const alertsLabel = unread > 0 ? `Alertas, ${unread} por ler` : 'Alertas'

  return (
    <div className="flex h-14 items-center justify-between">
      {backTo ? (
        <Link to={backTo} className={cn(bandIcon, '-ml-2.5')} aria-label={backLabel}>
          <ChevronLeft className="size-6" aria-hidden />
        </Link>
      ) : (
        <Link to={paths.home} aria-label="Vita Family, início" className="flex items-center gap-2 lg:hidden">
          <LogoMark className="size-8 rounded-lg ring-2 ring-white/40" />
          <span className="font-semibold">Vita Family</span>
        </Link>
      )}
      <div className="-mr-2.5 ml-auto flex items-center gap-1">
        <NavLink to={paths.alerts} aria-label={alertsLabel} className={({ isActive }) => cn(bandIcon, isActive && 'bg-white/15')}>
          <Bell className="size-5" aria-hidden />
          {unread > 0 && <span className="absolute top-2.5 right-2.5 size-2 rounded-full bg-danger ring-2 ring-primary" />}
        </NavLink>
        {/* No desktop as Configurações estão na sidebar. */}
        <NavLink
          to={paths.settings}
          aria-label="Configurações"
          className={({ isActive }) => cn(bandIcon, 'lg:hidden', isActive && 'bg-white/15')}
        >
          <Settings className="size-5" aria-hidden />
        </NavLink>
      </div>
    </div>
  )
}

interface PageProps {
  title: string
  description?: string
  /** Destino do botão voltar; sem ele mostra-se o logo (Home). */
  backTo?: string
  backLabel?: string
  /** Ação principal na faixa (ex.: “Editar perfil”, “+ Adicionar”). */
  action?: ReactNode
  /** Substitui o bloco de título (ex.: saudação da Home). */
  header?: ReactNode
  children: ReactNode
}

/**
 * Página da área autenticada: faixa azul (voltar/logo, alertas, configurações e título)
 * seguida do conteúdo centrado.
 */
export function Page({ title, description, backTo, backLabel = 'Voltar', action, header, children }: PageProps) {
  return (
    <>
      <header className="bg-primary pt-safe text-primary-foreground">
        <div className="mx-auto max-w-3xl px-4 pb-6 lg:px-8">
          <TopRow backTo={backTo} backLabel={backLabel} />
          {header ?? (
            <div className="flex items-end justify-between gap-4 pt-1">
              <div className="flex min-w-0 flex-col gap-1">
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                {description && <p>{description}</p>}
              </div>
              {action}
            </div>
          )}
        </div>
      </header>
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-6 pb-[max(2rem,env(safe-area-inset-bottom))] lg:px-8 lg:pb-12">
        {children}
      </div>
    </>
  )
}
