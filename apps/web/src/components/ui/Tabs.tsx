import { useId, useRef, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'

export interface TabItem<T extends string> {
  value: T
  label: string
}

interface TabsProps<T extends string> {
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  label: string
  /** Muitos separadores: deslizam na horizontal em vez de se apertarem. */
  scrollable?: boolean
  className?: string
}

/**
 * Separadores segmentados (ex.: Ativas / Histórico).
 * O painel associado usa `tabPanelProps(id, value)`.
 */
export function Tabs<T extends string>({ items, value, onChange, label, scrollable, className }: TabsProps<T>) {
  const baseId = useId()
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  function onKeyDown(event: KeyboardEvent, index: number) {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    event.preventDefault()
    const next = (index + step + items.length) % items.length
    const item = items[next]
    if (!item) return
    onChange(item.value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'flex gap-1 rounded-full bg-surface-muted p-1',
        scrollable && 'no-scrollbar overflow-x-auto',
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === value
        return (
          <button
            key={item.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="tab"
            id={`${baseId}-${item.value}`}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'h-9 rounded-full px-3 text-sm font-medium whitespace-nowrap transition-colors',
              scrollable ? 'shrink-0' : 'flex-1',
              selected ? 'bg-surface text-foreground shadow-card' : 'text-muted hover:text-foreground',
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
