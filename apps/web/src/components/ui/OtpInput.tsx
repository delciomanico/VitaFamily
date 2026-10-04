import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react'
import { cn } from '@/lib/cn'

/**
 * Texto novo numa caixa: ao escrever sobre um dígito existente fica só o novo;
 * o preenchimento automático (código inteiro) passa intacto.
 */
function typedText(raw: string, previous: string | undefined): string {
  return previous && raw.length === 2 ? raw.replace(previous, '') : raw
}

interface OtpInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  length?: number
  error?: boolean
  disabled?: boolean
}

/**
 * Código de N dígitos, uma caixa por dígito.
 * Avança sozinho, aceita colar o código inteiro e Backspace recua.
 */
export function OtpInput({ label, value, onChange, length = 6, error = false, disabled = false }: OtpInputProps) {
  const refs = useRef<Array<HTMLInputElement | null>>([])
  const focusAt = (index: number) => refs.current[Math.max(0, Math.min(index, length - 1))]?.focus()

  function insert(index: number, raw: string) {
    const digits = raw.replace(/\D/g, '')
    if (!digits) return
    const next = (value.slice(0, index) + digits).slice(0, length)
    onChange(next)
    focusAt(next.length)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === 'Backspace') {
      event.preventDefault()
      const target = value[index] ? index : index - 1
      if (target < 0) return
      onChange(value.slice(0, target) + value.slice(target + 1))
      focusAt(target)
    } else if (event.key === 'ArrowLeft') {
      focusAt(index - 1)
    } else if (event.key === 'ArrowRight') {
      focusAt(Math.min(index + 1, value.length))
    }
  }

  function onPaste(event: ClipboardEvent<HTMLInputElement>, index: number) {
    event.preventDefault()
    insert(index, event.clipboardData.getData('text'))
  }

  return (
    <div role="group" aria-label={label} className="flex justify-between gap-2">
      {Array.from({ length }, (_, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el
          }}
          value={value[index] ?? ''}
          onChange={(event) => insert(index, typedText(event.target.value, value[index]))}
          onKeyDown={(event) => onKeyDown(event, index)}
          onPaste={(event) => onPaste(event, index)}
          // Não deixa saltar caixas: o foco vai sempre para a próxima posição livre.
          onFocus={() => index > value.length && focusAt(value.length)}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          disabled={disabled}
          aria-label={`Dígito ${index + 1} de ${length}`}
          aria-invalid={error || undefined}
          className={cn(
            'h-14 w-full min-w-0 rounded-md border bg-surface text-center text-xl font-semibold transition-colors',
            'focus-visible:outline-2 focus-visible:outline-offset-0 disabled:opacity-60',
            error ? 'border-danger' : 'border-border',
          )}
        />
      ))}
    </div>
  )
}
