import { useEffect } from 'react'
import { FullScreenLoader } from '@/components/ui/states'
import { deliverOAuthResult } from '@/lib/ai/google'

/** Retorno do «Continuar com Google» (pop-up): entrega o token (fragmento do URL) à janela de origem e fecha. Nunca guarda nem regista o token. */
export function GoogleOAuthCallback() {
  useEffect(() => {
    deliverOAuthResult(window.location.hash)
  }, [])
  return <FullScreenLoader label="A concluir…" />
}
