import { useSearchParams } from 'react-router-dom'
import { Pencil } from 'lucide-react'
import { HealthProfileForm, profileToFormValues } from '@/components/domain/HealthProfileForm'
import { HealthProfileView } from '@/components/domain/HealthProfileView'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { healthService, type HealthProfileInput } from '@/services/health.service'

/** Perfil de saúde do próprio utilizador. `?editar` abre o formulário (o botão voltar funciona). */
export function HealthProfilePage() {
  const { user, family, member, refreshMembership } = useAuth()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const editing = params.has('editar')
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const memberId = member?.id ?? ''
  const { state, reload } = useAsync(
    () => healthService.getHealthProfile(familyId, userId, memberId),
    [familyId, userId, memberId],
  )

  const setEditing = (on: boolean) => setParams(on ? { editar: '' } : {}, { replace: !on })

  async function onSubmit(input: HealthProfileInput) {
    try {
      await healthService.saveHealthProfile(familyId, userId, memberId, input)
      await refreshMembership()
      toast.show('Perfil atualizado.')
      setEditing(false)
      reload()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  const editButton = !editing && state.status === 'success' && (
    <Button variant="secondary" size="sm" onClick={() => setEditing(true)} icon={<Pencil className="size-4" aria-hidden />}>
      Editar perfil
    </Button>
  )

  return (
    <>
      <PageHeader
        title={editing ? 'Editar perfil' : 'Perfil de saúde'}
        backTo={paths.health}
        backLabel="Saúde"
        action={editButton}
      />
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' &&
        (editing ? (
          <HealthProfileForm
            defaultValues={profileToFormValues(state.data)}
            onSubmit={onSubmit}
            submitLabel="Guardar"
            secondaryAction={
              <Button variant="ghost" size="lg" fullWidth onClick={() => setEditing(false)}>
                Cancelar
              </Button>
            }
          />
        ) : (
          <HealthProfileView profile={state.data} />
        ))}
    </>
  )
}
