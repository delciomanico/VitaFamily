import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Users } from 'lucide-react'
import { z } from 'zod'
import { Button, ButtonLink } from '@/components/ui/Button'
import { DetailSection, InfoList, InfoRow } from '@/components/ui/InfoList'
import { Input } from '@/components/ui/Input'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage } from '@/lib/errors'
import { roleLabels } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { familyService } from '@/services/family.service'
import { SettingsSubPage } from './SettingsPage'

const schema = z.object({ name: z.string().trim().min(2, 'Introduza o nome da família.') })

type FormValues = z.infer<typeof schema>

/** Família: nome (só o Admin altera, UC-FAM-03) e o seu papel. */
export function FamilySettingsPage() {
  const { user, family, member, refreshMembership } = useAuth()
  const toast = useToast()
  const isAdmin = member?.role === 'FAMILY_ADMIN'
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({ resolver: zodResolver(schema), values: { name: family?.name ?? '' } })

  async function save(values: FormValues) {
    try {
      await familyService.updateFamily(family?.id ?? '', user?.id ?? '', values.name)
      await refreshMembership()
      reset(values)
      toast.show('Nome da família alterado.')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  return (
    <SettingsSubPage title="Família">
      {isAdmin ? (
        <form onSubmit={handleSubmit(save)} noValidate className="flex flex-col gap-4">
          <Input label="Nome da família" error={errors.name?.message} {...register('name')} />
          <Button type="submit" size="lg" fullWidth loading={isSubmitting} disabled={!isDirty}>
            Guardar nome
          </Button>
        </form>
      ) : (
        <InfoList>
          <InfoRow label="Família" value={family?.name} />
        </InfoList>
      )}

      <DetailSection title="O seu papel">
        <InfoList>
          <InfoRow label="Papel" value={member?.role ? roleLabels[member.role] : '—'} />
        </InfoList>
        {!isAdmin && <p className="text-sm text-muted">Só o Administrador da família altera o nome.</p>}
      </DetailSection>

      <ButtonLink to={paths.family} variant="secondary" size="lg" icon={<Users className="size-4" aria-hidden />}>
        Ver membros
      </ButtonLink>
    </SettingsSubPage>
  )
}
