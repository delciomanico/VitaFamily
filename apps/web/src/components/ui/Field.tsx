import type { ReactNode } from 'react'

interface FieldProps {
  id: string
  label: string
  hint?: string
  error?: string
  children: ReactNode
}

/** Label, dica e erro partilhados por Input, Select e Textarea. */
export function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-hint`} className="text-sm text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

export function describedBy(id: string, hint?: string, error?: string) {
  if (error) return `${id}-error`
  if (hint) return `${id}-hint`
  return undefined
}

export const controlClasses =
  'w-full rounded-xl border bg-surface-muted px-3.5 text-base text-foreground placeholder:text-muted ' +
  'transition-colors focus:bg-surface focus-visible:outline-2 focus-visible:outline-offset-0 disabled:opacity-60'

export function controlState(error?: string) {
  return error ? 'border-danger' : 'border-border hover:border-border-strong'
}
