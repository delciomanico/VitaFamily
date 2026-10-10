import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { Eye, EyeOff, Lock, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Field, controlClasses, controlState, describedBy } from './Field'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
  error?: string
  /** Ícone à esquerda, dentro do campo. */
  icon?: LucideIcon
  /** Elemento à direita, dentro do campo (ex.: mostrar palavra-passe). */
  trailing?: ReactNode
  ref?: Ref<HTMLInputElement>
}

export function Input({ label, hint, error, icon: Icon, trailing, id, className, ...props }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId

  return (
    <Field id={inputId} label={label} hint={hint} error={error}>
      <div className="relative">
        {Icon && (
          <Icon
            className="pointer-events-none absolute top-1/2 left-3.5 size-[1.125rem] -translate-y-1/2 text-muted"
            aria-hidden
          />
        )}
        <input
          id={inputId}
          className={cn(controlClasses, controlState(error), 'h-12', Icon && 'pl-11', trailing != null && 'pr-12', className)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(inputId, hint, error)}
          {...props}
        />
        {trailing != null && <div className="absolute inset-y-0 right-1 flex items-center">{trailing}</div>}
      </div>
    </Field>
  )
}

type PasswordInputProps = Omit<InputProps, 'type' | 'icon' | 'trailing'>

/** Palavra-passe com cadeado e botão para mostrar/ocultar. */
export function PasswordInput(props: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const ToggleIcon = visible ? EyeOff : Eye

  return (
    <Input
      {...props}
      type={visible ? 'text' : 'password'}
      icon={Lock}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar palavra-passe' : 'Mostrar palavra-passe'}
          aria-pressed={visible}
          className="flex size-10 items-center justify-center rounded-full text-muted transition-colors hover:text-foreground"
        >
          <ToggleIcon className="size-[1.125rem]" aria-hidden />
        </button>
      }
    />
  )
}
