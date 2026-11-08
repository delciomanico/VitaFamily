import { Textarea } from '@/components/ui/Textarea'

interface ReportSectionFieldProps {
  label: string
  value: string
  max: number
  placeholder?: string
  disabled?: boolean
  onChange: (value: string) => void
}

/**
 * Campo de texto simples com limite do contrato (BR-CLN-41). O contador é a dica do campo
 * (`aria-describedby`); o texto-guia é só placeholder e nunca preenche o texto.
 */
export function ReportSectionField({ label, value, max, placeholder, disabled, onChange }: ReportSectionFieldProps) {
  return (
    <Textarea
      label={label}
      rows={4}
      maxLength={max}
      placeholder={placeholder}
      disabled={disabled}
      value={value}
      hint={`${value.length}/${max} caracteres`}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
