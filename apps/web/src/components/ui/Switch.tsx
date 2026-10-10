import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

interface SwitchProps {
  label: string
  description?: ReactNode
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}

/** Interruptor ligado/desligado com rótulo e descrição (linha de lista de preferências). */
export function Switch({ label, description, checked, onChange, disabled }: SwitchProps) {
  const id = useId()
  return (
    <div className="flex items-center gap-4 py-3">
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="block font-medium">
          {label}
        </label>
        {description && (
          <p id={`${id}-description`} className="text-sm text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-description` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'absolute top-1 left-1 size-5 rounded-full bg-white shadow-card transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </button>
    </div>
  )
}
