import { useCallback } from 'react'
import { useLocation, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
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

/**
 * Folha aberta por um parâmetro do endereço (`?adicionar`), para formulários que partem de uma página sem rota própria
 * (ex.: «Adicionar membro» em «Minha família»). `show` acrescenta uma entrada ao histórico (o botão voltar do telemóvel
 * fecha a folha); `close` volta atrás se foi a app a abri-la, senão só tira o parâmetro.
 */
export function useSheetParam(key: string) {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const open = params.has(key)
  const show = useCallback(() => {
    const next = new URLSearchParams(params)
    next.set(key, '1')
    navigate({ search: `?${next}` }, { state: { sheet: key } })
  }, [key, navigate, params])
  const close = useCallback(() => {
    if ((location.state as { sheet?: string } | null)?.sheet === key && canNavigateBack()) navigate(-1)
    else {
      const next = new URLSearchParams(params)
      next.delete(key)
      setParams(next, { replace: true })
    }
  }, [key, location.state, navigate, params, setParams])
  return { open, show, close }
}
