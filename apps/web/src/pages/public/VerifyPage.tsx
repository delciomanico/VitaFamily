import { useEffect, useState, type FormEvent } from 'react'
import { DemoHint } from '@/components/domain/DemoHint'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { OtpInput } from '@/components/ui/OtpInput'
import { FormError } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'

const CODE_LENGTH = 6
const RESEND_COOLDOWN_S = 30

/**
 * Verificação da conta por código (decisão do proprietário: código de 6 dígitos,
 * em vez do link por e-mail descrito em UC-ACC-01). O guard redireciona após o sucesso.
 */
export function VerifyPage() {
  const { pendingEmail, verify, resendCode } = useAuth()
  const toast = useToast()
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_S)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function submit(value: string) {
    setError(null)
    setSubmitting(true)
    try {
      await verify(value)
      toast.show('Conta verificada.')
    } catch (err) {
      setError(errorMessage(err))
      setCode('')
      setSubmitting(false)
    }
  }

  function onChange(value: string) {
    setCode(value)
    if (value.length === CODE_LENGTH) void submit(value)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (code.length === CODE_LENGTH) void submit(code)
  }

  async function onResend() {
    try {
      await resendCode()
      setCooldown(RESEND_COOLDOWN_S)
      toast.show('Enviámos um novo código.')
    } catch (err) {
      toast.show(errorMessage(err), 'error')
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Digite o código enviado"
        description={`Enviámos um código de ${CODE_LENGTH} dígitos para ${pendingEmail ?? 'o seu e-mail'}.`}
        backTo={paths.register}
      />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <OtpInput
          label="Código de verificação"
          value={code}
          onChange={onChange}
          length={CODE_LENGTH}
          error={Boolean(error)}
          disabled={submitting}
        />
        <FormError message={error} />
        <Button type="submit" size="lg" fullWidth loading={submitting} disabled={code.length < CODE_LENGTH}>
          Verificar
        </Button>
      </form>

      <Button variant="ghost" onClick={onResend} disabled={cooldown > 0}>
        {cooldown > 0 ? `Reenviar código em ${cooldown}s` : 'Reenviar código'}
      </Button>

      <DemoHint kind="verification" />
    </div>
  )
}
