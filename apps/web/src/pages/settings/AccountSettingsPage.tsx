import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { DetailSection, InfoList, InfoRow } from '@/components/ui/InfoList'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage } from '@/lib/errors'
import { formatLongDate } from '@/lib/format'
import { accountService } from '@/services/account.service'
import { SettingsSubPage } from './SettingsPage'

const schema = z.object({
  name: z.string().trim().min(2, 'Introduza o nome.'),
  timezone: z.string().min(1, 'Escolha o fuso horário.'),
})

type FormValues = z.infer<typeof schema>

/** Fusos IANA do navegador, com o atual garantido na lista. */
function timezoneOptions(current: string) {
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []
  return [...new Set([current, ...zones])].sort().map((value) => ({ value, label: value.replaceAll('_', ' ') }))
}

/** Minha conta (UC-ACC-04): nome e fuso horário; e-mail e data de nascimento só leitura. */
export function AccountSettingsPage() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: { name: user?.name ?? '', timezone: user?.timezone ?? '' },
  })

  if (!user) return null

  async function save(values: FormValues) {
    try {
      const updated = await accountService.updateMe(user!.id, values)
      setUser(updated)
      reset(values)
      toast.show('Conta atualizada.')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  return (
    <SettingsSubPage title="Minha conta">
      <DetailSection title="Dados da conta">
        <InfoList>
          <InfoRow label="E-mail" value={user.email} />
          <InfoRow label="Data de nascimento" value={formatLongDate(user.birthDate)} />
        </InfoList>
      </DetailSection>

      <form onSubmit={handleSubmit(save)} noValidate className="flex flex-col gap-4">
        <Input label="Nome" autoComplete="name" error={errors.name?.message} {...register('name')} />
        <Select
          label="Fuso horário"
          hint="Referência dos seus lembretes."
          options={timezoneOptions(user.timezone)}
          error={errors.timezone?.message}
          {...register('timezone')}
        />
        <Button type="submit" size="lg" fullWidth loading={isSubmitting} disabled={!isDirty}>
          Guardar alterações
        </Button>
      </form>
    </SettingsSubPage>
  )
}
