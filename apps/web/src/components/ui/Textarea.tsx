import { useId, type Ref, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'
import { Field, controlClasses, controlState, describedBy } from './Field'

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
  hint?: string
  error?: string
  ref?: Ref<HTMLTextAreaElement>
}

export function Textarea({ label, hint, error, id, className, rows = 3, ...props }: TextareaProps) {
  const generatedId = useId()
  const textareaId = id ?? generatedId

  return (
    <Field id={textareaId} label={label} hint={hint} error={error}>
      <textarea
        id={textareaId}
        rows={rows}
        className={cn(controlClasses, controlState(error), 'resize-y py-3', className)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(textareaId, hint, error)}
        {...props}
      />
    </Field>
  )
}
