import type { ReactNode } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface Choice<T extends string> {
  value: T
  label: ReactNode
  hint?: string
}

interface BaseProps<T extends string> {
  legend: string
  options: Choice<T>[]
  disabled?: boolean
  error?: string | null
  /** Esconde a legenda (quando o título do passo já a diz) sem a perder para leitores de ecrã. */
  hideLegend?: boolean
  /** Duas colunas (opções curtas: duração, dias). */
  columns?: 1 | 2
}

function Card({ type, name, value, checked, disabled, label, hint, onChange }: { type: 'radio' | 'checkbox'; name: string; value: string; checked: boolean; disabled?: boolean; label: ReactNode; hint?: string; onChange: (checked: boolean) => void }) {
  return (
    <label
      className={cn(
        'relative flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border-2 bg-surface px-4 py-3 transition-colors',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-primary',
        checked ? 'border-primary bg-primary-soft' : 'border-border hover:border-border-strong',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input type={type} name={name} value={value} checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="sr-only" />
      <span className={cn('flex size-7 shrink-0 items-center justify-center border-2', type === 'radio' ? 'rounded-full' : 'rounded-md', checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong bg-surface')} aria-hidden>
        {checked && <Check className="size-4" strokeWidth={3} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-lg leading-6 font-medium">{label}</span>
        {hint && <span className="text-base text-muted">{hint}</span>}
      </span>
    </label>
  )
}

/** Uma escolha entre várias, em cartões grandes (rádios nativos: setas do teclado, foco visível, leitor de ecrã). */
export function ChoiceList<T extends string>({ legend, options, value, onChange, disabled, error, hideLegend, columns = 1 }: BaseProps<T> & { value: T | ''; onChange: (value: T) => void }) {
  const name = legend
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3">
      <legend className={cn('mb-1 text-base font-medium', hideLegend && 'sr-only')}>{legend}</legend>
      <div className={cn('grid gap-3', columns === 2 && 'grid-cols-2')}>
        {options.map((option) => (
          <Card key={option.value} type="radio" name={name} value={option.value} checked={value === option.value} disabled={disabled} label={option.label} hint={option.hint} onChange={() => onChange(option.value)} />
        ))}
      </div>
      {error && (
        <p role="alert" className="text-base text-danger">
          {error}
        </p>
      )}
    </fieldset>
  )
}

/** Várias escolhas, em cartões grandes (caixas de seleção nativas). */
export function ChoiceChecks<T extends string>({ legend, options, value, onChange, disabled, error, hideLegend, columns = 1 }: BaseProps<T> & { value: T[]; onChange: (value: T[]) => void }) {
  return (
    <fieldset disabled={disabled} className="flex flex-col gap-3">
      <legend className={cn('mb-1 text-base font-medium', hideLegend && 'sr-only')}>{legend}</legend>
      <div className={cn('grid gap-3', columns === 2 && 'grid-cols-2')}>
        {options.map((option) => (
          <Card
            key={option.value}
            type="checkbox"
            name={legend}
            value={option.value}
            checked={value.includes(option.value)}
            disabled={disabled}
            label={option.label}
            hint={option.hint}
            onChange={(checked) => onChange(checked ? [...value, option.value] : value.filter((item) => item !== option.value))}
          />
        ))}
      </div>
      {error && (
        <p role="alert" className="text-base text-danger">
          {error}
        </p>
      )}
    </fieldset>
  )
}
