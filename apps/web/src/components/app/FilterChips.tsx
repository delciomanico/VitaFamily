import { cn } from '@/lib/cn'

export interface ChipItem<T extends string> {
  value: T
  label: string
}

interface FilterChipsProps<T extends string> {
  items: ChipItem<T>[]
  value: T
  onChange: (value: T) => void
  label: string
}

/** Filtros em «pílulas» que deslizam na horizontal (padrão das apps móveis); o ativo tem cor cheia e `aria-pressed`. */
export function FilterChips<T extends string>({ items, value, onChange, label }: FilterChipsProps<T>) {
  return (
    <div role="group" aria-label={label} className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 py-1">
      {items.map((item) => {
        const active = item.value === value
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(item.value)}
            className={cn(
              'min-h-12 shrink-0 rounded-full border px-5 text-base font-medium whitespace-nowrap transition-colors',
              active ? 'border-primary bg-primary font-semibold text-primary-foreground shadow-button' : 'border-transparent bg-surface text-foreground shadow-card hover:bg-surface-muted',
            )}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}
