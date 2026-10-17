import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { canNavigateBack } from '@/lib/navigation'

/**
 * Botão/link "voltar": se o utilizador chegou aqui navegando dentro da app, volta mesmo ao
 * ecrã anterior (`navigate(-1)`), preservando scroll e estado de formulários a meio.
 * Só cai no destino fixo `fallback` quando não há histórico da SPA para onde voltar
 * (link direto, recarregar a página, abrir a partir de uma notificação).
 */
export function useBackTo(fallback: string) {
  const navigate = useNavigate()
  return (event: MouseEvent) => {
    event.preventDefault()
    if (canNavigateBack()) {
      navigate(-1)
    } else {
      navigate(fallback, { replace: true })
    }
  }
}
