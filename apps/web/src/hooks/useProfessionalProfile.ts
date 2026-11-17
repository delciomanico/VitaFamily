import { useAsync } from '@/hooks/useAsync'
import { editRights } from '@/lib/professional'
import { professionalPortalService } from '@/services/professionalPortal.service'

/**
 * Perfil do profissional em sessão (`GET /professional-portal/me`), relido por página: o estado de validação
 * vem sempre do servidor, nunca do token (authorization.md §10.1). `rights` só evita oferecer ações que o
 * servidor recusaria com `PROFESSIONAL_LOCKED`.
 */
export function useProfessionalProfile() {
  const { state, reload } = useAsync(() => professionalPortalService.getMe(), [])
  const profile = state.status === 'success' ? state.data : null
  return { state, reload, profile, rights: profile ? editRights(profile.validationStatus) : null }
}
