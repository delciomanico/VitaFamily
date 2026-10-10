import { useEffect, useRef, useState } from 'react'

/**
 * Quantas linhas de altura fixa (`rowHeight`, px) cabem no elemento observado.
 * Usado para mostrar só o que cabe num ecrã fixo, sem scroll nem linhas cortadas.
 */
export function useFitCount<T extends HTMLElement>(rowHeight: number) {
  const ref = useRef<T>(null)
  const [count, setCount] = useState(0)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => setCount(Math.max(0, Math.floor(element.clientHeight / rowHeight)))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [rowHeight])

  return { ref, count }
}
