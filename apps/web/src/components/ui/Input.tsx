import { useId, type InputHTMLAttributes, type Ref } from 'react'
import { cn } from '@/lib/cn'
import { Field, controlClasses, controlState, describedBy } from './Field'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
  ref?: Ref<HTMLInputElement>
}

export function Input({ label, hint, error, id, className, ...props }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <Field id={inputId} label={label} hint={hint} error={error}>
      <input
        id={inputId}
        className={cn(controlClasses, controlState(error), 'h-12', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(inputId, hint, error)}
        {...props}
      />
    </Field>
  )
}
