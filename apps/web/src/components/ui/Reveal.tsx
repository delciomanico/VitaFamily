import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface RevealProps {
  children: ReactNode
  /** Atraso em ms, para escalonar elementos irmãos. */
  delay?: number
  className?: string
}

/**
 * Faz o conteúdo surgir (fade + subida) quando entra no ecrã. Sem `IntersectionObserver`
 * (testes, browsers antigos) ou com «reduzir animações», aparece logo.
 */
export function Reveal({ children, delay = 0, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null)
  const canObserve = typeof IntersectionObserver !== 'undefined'
  const [visible, setVisible] = useState(!canObserve)

  useEffect(() => {
    const node = ref.current
    if (!node || !canObserve) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [canObserve])

  return (
    <div
      ref={ref}
      style={{ transitionDelay: visible ? `${delay}ms` : undefined }}
      className={cn(
        'transition-[opacity,transform] duration-700 ease-out motion-reduce:transition-none',
        visible ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100',
        className,
      )}
    >
      {children}
    </div>
  )
}
