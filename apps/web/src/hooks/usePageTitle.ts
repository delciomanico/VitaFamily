import { useEffect } from 'react'

/** Título do separador por página (SEO e acessibilidade): «Título · Vita Family». */
export function usePageTitle(title?: string) {
  useEffect(() => {
    const previous = document.title
    document.title = title ? `${title} · Vita Family` : 'Vita Family'
    return () => {
      document.title = previous
    }
  }, [title])
}
