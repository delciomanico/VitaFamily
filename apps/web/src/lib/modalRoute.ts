import { useCallback } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { canNavigateBack } from '@/lib/navigation'

/**
 * Formulários abertos como folha por cima de um ecrã (rota aninhada): o ecrã de baixo fica montado e passa
 * `onSaved` no contexto do `<Outlet>` para se atualizar quando a folha guarda.
 */
export interface ModalOutletContext {
  onSaved?: () => void
}

/**
 * `close` fecha a folha: volta mesmo atrás se a navegação veio da app (o botão voltar do telemóvel faz o mesmo);
 * num link direto, substitui pela rota de baixo (`parent`). `saved` avisa o ecrã de baixo e fecha.
 */
export function useModalRoute(parent: string) {
  const navigate = useNavigate()
  const context = useOutletContext<ModalOutletContext | null>()
  const close = useCallback(() => {
    if (canNavigateBack()) navigate(-1)
    else navigate(parent, { replace: true })
  }, [navigate, parent])
  const saved = useCallback(() => {
    context?.onSaved?.()
    close()
  }, [context, close])
  return { close, saved }
}
