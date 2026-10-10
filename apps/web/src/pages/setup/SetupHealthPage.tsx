import { useNavigate } from 'react-router-dom'
import { HealthProfileForm, profileToFormValues } from '@/components/domain/HealthProfileForm'
import { AuthScreen } from '@/components/layout/AuthScreen'
import { Button } from '@/components/ui/Button'
import { ErrorState, LoadingState } from '@/components/ui/states'
import { useToast } from '@/components/ui/Toast'
import { useAuth } from '@/contexts/AuthContext'
import { useAsync } from '@/hooks/useAsync'
import { errorMessage } from '@/lib/errors'
import { paths } from '@/routes/paths'
import { healthService, type HealthProfileInput } from '@/services/health.service'
import { SETUP_STEPS } from './steps'

export function SetupHealthPage() {
  const { user, family, member, refreshMembership } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const familyId = family?.id ?? ''
  const userId = user?.id ?? ''
  const memberId = member?.id ?? ''
  const { state, reload } = useAsync(
    () => healthService.getHealthProfile(familyId, userId, memberId),
    [familyId, userId, memberId],
  )

  // Quem criou a família (Admin) segue para adicionar membros; quem entrou por convite termina aqui.
  const isAdmin = member?.role === 'FAMILY_ADMIN'
  const total = isAdmin ? SETUP_STEPS.create : SETUP_STEPS.join
  const next = () => navigate(isAdmin ? paths.setupMembers : paths.home)

  async function onSubmit(input: HealthProfileInput) {
    try {
      await healthService.saveHealthProfile(familyId, userId, memberId, input)
      await refreshMembership()
      next()
    } catch (error) {
      toast.show(errorMessage(error), 'error')
    }
  }

  const skip = (
    <Button variant="soft" size="lg" fullWidth onClick={next}>
      Pular por agora
    </Button>
  )

  return (
    <AuthScreen
      title="Perfil de saúde"
      description="Estas informações ajudam a acompanhar a sua saúde."
      progress={{ step: 2, total }}
    >
      {state.status === 'loading' && <LoadingState rows={4} />}
      {state.status === 'error' && <ErrorState onRetry={reload} />}
      {state.status === 'success' && (
        <HealthProfileForm
          defaultValues={profileToFormValues(state.data)}
          onSubmit={onSubmit}
          submitLabel="Continuar"
          secondaryAction={skip}
        />
      )}
    </AuthScreen>
  )
}
