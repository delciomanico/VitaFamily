import { useEffect } from 'react'

/** Liga o fundo azul sólido (`html.on-brand`, ver index.css) enquanto a shell da família ou do profissional está montada. */
export function useBrandBackground() {
  useEffect(() => {
    const root = document.documentElement
    root.classList.add('on-brand')
    return () => root.classList.remove('on-brand')
  }, [])
}
