import { useEffect } from 'react'

/**
 * Interruptor do fundo azul sólido: `false` = fundo branco (tokens claros do @theme); `true` liga `html.on-brand`.
 * Os detalhes gráficos do `AppBackdrop` aparecem nos dois modos.
 */
export const BRAND_BACKGROUND = false

/** Liga o fundo azul sólido (`html.on-brand`, ver index.css) enquanto a shell da família ou do profissional está montada. */
export function useBrandBackground() {
  useEffect(() => {
    if (!BRAND_BACKGROUND) return
    const root = document.documentElement
    root.classList.add('on-brand')
    return () => root.classList.remove('on-brand')
  }, [])
}
