import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { FormSheet } from '@/components/app/FormSheet'
import { Button } from '@/components/ui/Button'
import { DetailSection, InfoList, InfoRow } from '@/components/ui/InfoList'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage } from '@/lib/errors'
import { formatLongDate } from '@/lib/format'
import { useSheetParam } from '@/lib/modalRoute'
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

/** Minha conta (UC-ACC-04): e-mail e data de nascimento só leitura; nome e fuso horário editam-se numa folha. */
export function AccountSettingsPage() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const { open, show, close } = useSheetParam('editar')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    values: { name: user?.name ?? '', timezone: user?.timezone ?? '' },
  })

  if (!user) return null

  async function save(values: FormValues) {
    setSubmitError(null)
    try {
      const updated = await accountService.updateMe(user!.id, values)
      setUser(updated)
      toast.show('Conta atualizada.')
      close()
    } catch (error) {
      setSubmitError(errorMessage(error))
    }
  }

  return (
    <SettingsSubPage title="Minha conta">
      <DetailSection title="Dados da conta">
        <InfoList>
          <InfoRow label="Nome" value={user.name} />
          <InfoRow label="E-mail" value={user.email} />
          <InfoRow label="Data de nascimento" value={formatLongDate(user.birthDate)} />
          <InfoRow label="Fuso horário" value={user.timezone.replaceAll('_', ' ')} />
        </InfoList>
      </DetailSection>
      <Button size="xl" fullWidth onClick={show} icon={<Pencil className="size-5" aria-hidden />}>
        Editar nome e fuso horário
      </Button>

      {open && (
        <FormSheet title="Editar a minha conta" onClose={close} dirty={isDirty} onSubmit={handleSubmit(save)} submitLabel="Guardar alterações" busy={isSubmitting} error={submitError}>
          <Input label="Nome" autoComplete="name" error={errors.name?.message} {...register('name')} />
          <Select label="Fuso horário" hint="Referência dos seus lembretes." options={timezoneOptions(user.timezone)} error={errors.timezone?.message} {...register('timezone')} />
        </FormSheet>
      )}
    </SettingsSubPage>
  )
}
