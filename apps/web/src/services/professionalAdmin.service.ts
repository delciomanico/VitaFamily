import * as mock from '@/mocks/handlers/professionalAdmin'
import type {
  AdminProfessionalDetail,
  AdminProfessionalFilters,
  AdminProfessionalPage,
  AdminSpecialty,
  ProfessionalDecisionInput,
  SpecialtyInput,
  SpecialtyPatch,
} from '@/types/professional'

/**
 * Validação de profissionais e catálogo de especialidades (`/admin/professionals*`, `/admin/specialties*`,
 * MK1). Mesma sessão de `User` com `platformRole` da área `/admin`. Fatia F: só backend simulado; a
 * assinatura é a do contrato. O admin nunca lê `paymentInstructions`, ofertas, horários nem dados de saúde.
 */
export const professionalAdminService = {
  list: (filters?: AdminProfessionalFilters): Promise<AdminProfessionalPage> => mock.adminListProfessionals(filters),
  get: (professionalId: string): Promise<AdminProfessionalDetail> => mock.adminGetProfessional(professionalId),
  decide: (professionalId: string, input: ProfessionalDecisionInput): Promise<AdminProfessionalDetail> =>
    mock.adminDecideProfessional(professionalId, input),
  downloadCredential: (professionalId: string, credentialId: string): Promise<Blob> =>
    mock.adminDownloadProfessionalCredential(professionalId, credentialId),
  listSpecialties: (): Promise<AdminSpecialty[]> => mock.adminListSpecialties(),
  createSpecialty: (input: SpecialtyInput): Promise<AdminSpecialty> => mock.adminCreateSpecialty(input),
  updateSpecialty: (specialtyId: string, patch: SpecialtyPatch): Promise<AdminSpecialty> => mock.adminUpdateSpecialty(specialtyId, patch),
}
