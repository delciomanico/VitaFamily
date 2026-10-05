import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { PasswordInput } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage, isAppError } from '@/lib/errors'
import { PASSWORD_MIN_LENGTH } from '@/lib/policy'
import { accountService } from '@/services/account.service'
import { SettingsSubPage } from './SettingsPage'

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Introduza a palavra-passe atual.'),
    newPassword: z.string().min(PASSWORD_MIN_LENGTH, `Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`),
    confirm: z.string(),
  })
  .refine((v) => v.confirm === v.newPassword, { path: ['confirm'], message: 'As palavras-passe não coincidem.' })

type FormValues = z.infer<typeof schema>

/** Segurança: alterar a palavra-passe (as outras sessões terminam). */
export function SecuritySettingsPage() {
  const { user } = useAuth()
  const toast = useToast()
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  async function save({ currentPassword, newPassword }: FormValues) {
    try {
      await accountService.changePassword(user?.id ?? '', { currentPassword, newPassword })
      reset()
      toast.show('Palavra-passe alterada.')
    } catch (error) {
      if (isAppError(error, 'INVALID_CREDENTIALS')) {
        setError('currentPassword', { message: 'A palavra-passe atual não está correta.' })
      } else {
        toast.show(errorMessage(error), 'error')
      }
    }
  }

  return (
    <SettingsSubPage title="Segurança">
      <form onSubmit={handleSubmit(save)} noValidate className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">Alterar palavra-passe</h2>
        <PasswordInput
          label="Palavra-passe atual"
          autoComplete="current-password"
          error={errors.currentPassword?.message}
          {...register('currentPassword')}
        />
        <PasswordInput
          label="Nova palavra-passe"
          autoComplete="new-password"
          hint={`Pelo menos ${PASSWORD_MIN_LENGTH} caracteres. Uma frase é fácil de lembrar.`}
          error={errors.newPassword?.message}
          {...register('newPassword')}
        />
        <PasswordInput
          label="Confirmar nova palavra-passe"
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...register('confirm')}
        />
        <p className="text-sm text-muted">Por segurança, as sessões noutros dispositivos são terminadas.</p>
        <Button type="submit" size="lg" fullWidth loading={isSubmitting}>
          Alterar palavra-passe
        </Button>
      </form>
    </SettingsSubPage>
  )
}
