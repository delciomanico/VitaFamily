import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FormSheet } from '@/components/app/FormSheet'
import { PasswordInput } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage, isAppError } from '@/lib/errors'
import { useModalRoute } from '@/lib/modalRoute'
import { PASSWORD_MIN_LENGTH } from '@/lib/policy'
import { accountService } from '@/services/account.service'
import { paths } from '@/routes/paths'

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Introduza a palavra-passe atual.'),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH, `Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`),
    confirm: z.string(),
  })
  .refine((v) => v.confirm === v.newPassword, { path: ['confirm'], message: 'As palavras-passe não coincidem.' })

type FormValues = z.infer<typeof schema>

/** Segurança: alterar a palavra-passe numa folha por cima das Configurações (as outras sessões terminam). */
export function SecuritySettingsPage() {
  const { user } = useAuth()
  const toast = useToast()
  const { close, saved } = useModalRoute(paths.settings)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  async function save({ currentPassword, newPassword }: FormValues) {
    setSubmitError(null)
    try {
      await accountService.changePassword(user?.id ?? '', { currentPassword, newPassword })
      toast.show('Palavra-passe alterada.')
      setDone(true)
      saved()
    } catch (error) {
      if (isAppError(error, 'INVALID_CREDENTIALS')) {
        setError('currentPassword', { message: 'A palavra-passe atual não está correta.' })
      } else {
        setSubmitError(errorMessage(error))
      }
    }
  }

  return (
    <FormSheet title="Alterar palavra-passe" description="Por segurança, as sessões noutros dispositivos são terminadas." onClose={close} dirty={isDirty && !done} onSubmit={handleSubmit(save)} submitLabel="Alterar palavra-passe" busy={isSubmitting} error={submitError}>
      <PasswordInput label="Palavra-passe atual" autoComplete="current-password" error={errors.currentPassword?.message} {...register('currentPassword')} />
      <PasswordInput
        label="Nova palavra-passe"
        autoComplete="new-password"
        hint={`Pelo menos ${PASSWORD_MIN_LENGTH} caracteres. Uma frase é fácil de lembrar.`}
        error={errors.newPassword?.message}
        {...register('newPassword')}
      />
      <PasswordInput label="Confirmar nova palavra-passe" autoComplete="new-password" error={errors.confirm?.message} {...register('confirm')} />
    </FormSheet>
  )
}
