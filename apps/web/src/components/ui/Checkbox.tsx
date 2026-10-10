import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'

interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: ReactNode
  error?: string
  ref?: Ref<HTMLInputElement>
}

export function Checkbox({ label, error, id, ...props }: CheckboxProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          id={inputId}
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 cursor-pointer accent-primary"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined}
          {...props}
        />
        <span>{label}</span>
      </label>
      {error && (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
