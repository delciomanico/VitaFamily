import { useId } from 'react'
import { Check } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/cn'
import { SPECIALTY_SUGGESTIONS } from '@/types/appointment'

interface SpecialtyFieldProps {
  value: string
  onChange: (value: string) => void
  error?: string
}

/** Especialidade (TBD no domínio): sugestões em pílula ou texto livre. */
export function SpecialtyField({ value, onChange, error }: SpecialtyFieldProps) {
  return (
    <div className="flex flex-col gap-3">
      <Input
        label="Especialidade"
        placeholder="Ex.: Cardiologia"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        error={error}
      />
      <ul className="flex flex-wrap gap-2" aria-label="Sugestões de especialidade">
        {SPECIALTY_SUGGESTIONS.map((specialty) => {
          const selected = value === specialty
          return (
            <li key={specialty}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(specialty)}
                className={cn(
                  'h-9 rounded-full border px-3.5 text-sm font-medium transition-colors',
                  selected
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border bg-surface hover:border-border-strong',
                )}
              >
                {specialty}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

interface ChoiceListProps<T extends string> {
  label: string
  options: Array<{ value: T; title: string; description?: string }>
  value: T | null
  onChange: (value: T) => void
}

/** Escolha única em lista (membro, clínica): linhas grandes, fáceis de tocar. */
export function ChoiceList<T extends string>({ label, options, value, onChange }: ChoiceListProps<T>) {
  const labelId = useId()
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-sm font-medium">
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="divide-y divide-border rounded-xl border border-border bg-surface shadow-card"
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(option.value)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-surface-muted"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{option.title}</span>
                {option.description && <span className="block text-sm text-muted">{option.description}</span>}
              </span>
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full border-2',
                  selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong',
                )}
                aria-hidden
              >
                {selected && <Check className="size-3.5" strokeWidth={3} />}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Sem clínica (BR-APT-04 permite consulta sem clínica). */
export const NO_CLINIC = 'NONE'
