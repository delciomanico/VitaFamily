import { useEffect, useState } from 'react'

const QUERY = '(min-width: 1024px)'

/** `true` a partir do breakpoint `lg` (1024 px). Sem `matchMedia` (testes) assume ecrã pequeno. */
export function useIsDesktop(): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const [matches, setMatches] = useState(() => (supported ? window.matchMedia(QUERY).matches : false))
  useEffect(() => {
    if (!supported) return
    const list = window.matchMedia(QUERY)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [supported])
  return matches
}
