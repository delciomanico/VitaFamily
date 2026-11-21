import { Pencil } from 'lucide-react'
import { HealthProfileForm, profileToFormValues } from '@/components/domain/HealthProfileForm'
import { HealthProfileView } from '@/components/domain/HealthProfileView'
import { Page } from '@/components/layout/Page'
import { Button } from '@/components/ui/Button'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { useSheetParam } from '@/lib/modalRoute'
import { paths } from '@/routes/paths'
import { healthService, type HealthProfileInput } from '@/services/health.service'

/** Perfil de saúde do próprio utilizador. `?editar` abre o formulário (o botão voltar funciona). */
export function HealthProfilePage() {
  const { user, family, member, refreshMembership } = useAuth()
  const toast = useToast()
  const { open: editing, show: startEditing, close: closeSheet } = useSheetParam('editar')
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const memberId = member?.id ?? ''
  const { state, reload } = useAsync(
    () => healthService.getHealthProfile(familyId, userId, memberId),
    [familyId, userId, memberId],
  )

  async function onSubmit(input: HealthProfileInput) {
    await healthService.saveHealthProfile(familyId, userId, memberId, input)
    await refreshMembership()
    toast.show('Perfil atualizado.')
    closeSheet()
    reload()
  }

  const editButton = state.status === 'success' && (
    <Button variant="secondary" size="sm" onClick={startEditing} icon={<Pencil className="size-4" aria-hidden />}>
      Editar perfil
    </Button>
  )

  return (
    <Page title="Perfil de saúde" backTo={paths.health} backLabel="Saúde" action={editButton}>
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && <HealthProfileView profile={state.data} />}
      {/* Editar: folha por cima do perfil (`?editar`); o botão voltar do telemóvel fecha-a. */}
      {state.status === 'success' && editing && (
        <HealthProfileForm
          defaultValues={profileToFormValues(state.data)}
          onSubmit={onSubmit}
          submitLabel="Guardar"
          sheet={{ title: 'Editar perfil', onClose: closeSheet }}
        />
      )}
    </Page>
  )
}
