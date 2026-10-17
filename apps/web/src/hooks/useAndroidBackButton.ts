import { useEffect } from 'react'
import { App } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { canNavigateBack } from '@/lib/navigation'
import { router } from '@/routes/router'

/**
 * No WebView do Capacitor, o botão/gesto físico de voltar do Android não está ligado por
 * omissão à navegação da SPA. Volta ao ecrã anterior quando há histórico da app; quando já
 * está no topo (ex.: Início logo depois do login), minimiza a app — comportamento nativo
 * esperado, em vez de ficar sem reação ou fechar a app a meio de um ecrã.
 */
export function useAndroidBackButton() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const listenerPromise = App.addListener('backButton', () => {
      if (canNavigateBack()) {
        router.navigate(-1)
      } else {
        App.exitApp()
      }
    })

    return () => {
      listenerPromise.then((listener) => listener.remove())
    }
  }, [])
}
