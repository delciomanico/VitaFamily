import { useEffect, useState } from 'react'
import { Outlet, useLocation, useMatches } from 'react-router-dom'
import { BottomNav } from '@/components/app/BottomNav'
import { ProfessionalAuthProvider } from '@/contexts/ProfessionalAuthContext'
import { cn } from '@/lib/cn'
import { AppBackdrop } from './AppBackdrop'
import { useBrandBackground } from './useBrandBackground'
import { professionalConversationService } from '@/services/professionalConversation.service'

/** Opções de uma rota do portal (`handle` no router): ecrãs de passo a passo e conversa escondem a barra inferior. */
export interface ProfessionalRouteHandle {
  /** Sem barra inferior (passo a passo, conversa em ecrã inteiro). */
  hideNav?: boolean
  /** Sem margens: o ecrã gere o seu próprio espaço (conversa). */
  bare?: boolean
}

/**
 * Raiz de `/profissional/*` (ADR-037): monta a sessão de `ProfessionalAccount` **só** nesta árvore de rotas,
 * sem ligação ao `AuthProvider` da família nem ao `ClinicAuthProvider`.
 */
export function ProfessionalPortalRoot() {
  return (
    <ProfessionalAuthProvider>
      <Outlet />
    </ProfessionalAuthProvider>
  )
}

/** Mensagens por ler, relidas a cada mudança de ecrã (o contador da barra inferior nunca fica desatualizado). */
function useUnreadMessages(): number {
  const { pathname } = useLocation()
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    let active = true
    professionalConversationService.list('OPEN').then(
      (page) => active && setUnread(page.items.reduce((sum, row) => sum + row.unreadCount, 0)),
      () => undefined,
    )
    return () => {
      active = false
    }
  }, [pathname])
  return unread
}

/**
 * Portal do profissional como app móvel: uma coluna centrada de largura de telemóvel (também em ecrã largo),
 * barra inferior fixa com 4 separadores e conteúdo por ecrã. A família nunca partilha esta árvore.
 */
export function ProfessionalShell() {
  const unread = useUnreadMessages()
  useBrandBackground()
  const handle = (useMatches().at(-1)?.handle ?? {}) as ProfessionalRouteHandle

  return (
    <div className="app-mobile min-h-dvh bg-brand-deep">
      <AppBackdrop column />
      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[34rem] flex-col sm:shadow-overlay">
        <main
          id="conteudo"
          className={cn(
            'flex flex-1 flex-col',
            !handle.bare && 'gap-5 px-5 pt-[max(1.25rem,env(safe-area-inset-top))]',
            !handle.bare && (handle.hideNav ? 'pb-0' : 'pb-[calc(6.5rem+env(safe-area-inset-bottom))]'),
          )}
        >
          <Outlet />
        </main>
      </div>
      {!handle.hideNav && <BottomNav unread={unread} />}
    </div>
  )
}
