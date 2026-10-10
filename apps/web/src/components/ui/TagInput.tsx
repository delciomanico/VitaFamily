import { useId, useState, type KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Button } from './Button'
import { controlClasses, controlState } from './Field'

interface TagInputProps {
  label: string
  values: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  hint?: string
}

/** Lista de textos curtos (ex.: alergias): escrever + Adicionar, remover em cada etiqueta. */
export function TagInput({ label, values, onChange, placeholder, hint }: TagInputProps) {
  const id = useId()
  const [draft, setDraft] = useState('')

  function add() {
    const text = draft.trim()
    if (!text) return
    const exists = values.some((v) => v.toLowerCase() === text.toLowerCase())
    if (!exists) onChange([...values, text])
    setDraft('')
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return
    event.preventDefault()
    add()
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={cn(controlClasses, controlState(), 'h-12')}
        />
        <Button variant="secondary" size="lg" onClick={add} aria-label={`Adicionar a ${label}`} className="px-3.5">
          <Plus className="size-5" aria-hidden />
        </Button>
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2 pt-1" aria-label={label}>
          {values.map((value) => (
            <li
              key={value}
              className="inline-flex items-center gap-1 rounded-full bg-primary-soft py-1 pr-1 pl-3 text-sm text-primary"
            >
              {value}
              <button
                type="button"
                onClick={() => onChange(values.filter((v) => v !== value))}
                className="rounded-full p-1 hover:bg-primary/10"
                aria-label={`Remover ${value}`}
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
