import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import { zodResolver } from '@hookform/resolvers/zod'
import { LogOut, Users } from 'lucide-react'
import { z } from 'zod'
import { Button, ButtonLink } from '@/components/ui/Button'
import { DetailSection, InfoList, InfoRow } from '@/components/ui/InfoList'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { errorMessage } from '@/lib/errors'
import { roleLabels } from '@/lib/labels'
import { paths } from '@/routes/paths'
import { familyService, type LeaveFamilyDataChoice } from '@/services/family.service'
import { SettingsSubPage } from './SettingsPage'

const schema = z.object({ name: z.string().trim().min(2, 'Introduza o nome da família.') })

type FormValues = z.infer<typeof schema>

/** Sair da família (UC-MEM-09, R4): o próprio escolhe levar ou apagar os dados antes de saír. */
function LeaveFamily() {
  const { user, family, refreshMembership } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [leaving, setLeaving] = useState<LeaveFamilyDataChoice>()

  async function leave(dataChoice: LeaveFamilyDataChoice) {
    setLeaving(dataChoice)
    try {
      await familyService.leaveFamily(family?.id ?? '', user?.id ?? '', dataChoice)
      await refreshMembership()
      setOpen(false)
      navigate(paths.home, { replace: true })
      toast.show(dataChoice === 'TAKE' ? 'Saiu da família; os seus dados foram exportados.' : 'Saiu da família.')
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    } finally {
      setLeaving(undefined)
    }
  }

  return (
    <DetailSection title="Sair da família">
      <p className="text-sm text-muted">
        Deixa de fazer parte desta família. Pode levar os seus dados (pacote para descarregar) ou apagá-los.
      </p>
      <Button
        variant="danger-ghost"
        size="lg"
        fullWidth
        onClick={() => setOpen(true)}
        icon={<LogOut className="size-5" aria-hidden />}
      >
        Sair da família
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Sair da família?"
        description="Esta ação não se pode desfazer. Se for o único Admin ou o único tutor de um dependente, tem de resolver isso primeiro."
      >
        <div className="flex flex-col gap-2">
          <Button variant="secondary" size="lg" fullWidth loading={leaving === 'TAKE'} onClick={() => leave('TAKE')}>
            Levar os meus dados e sair
          </Button>
          <Button variant="danger" size="lg" fullWidth loading={leaving === 'DELETE'} onClick={() => leave('DELETE')}>
            Apagar os meus dados e sair
          </Button>
        </div>
      </Modal>
    </DetailSection>
  )
}

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

      <LeaveFamily />
    </SettingsSubPage>
  )
}
