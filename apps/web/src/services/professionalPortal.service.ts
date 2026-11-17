import * as mock from '@/mocks/handlers/professionalPortal'
import type {
  CredentialUploadInput,
  ProfessionalCredential,
  ProfessionalOffer,
  ProfessionalOfferInput,
  ProfessionalOfferPatch,
  ProfessionalProfile,
  ProfessionalProfilePatch,
  ProfessionalRegisterInput,
  ProfessionalScheduleRule,
  ProfessionalScheduleRuleInput,
  ProfessionalScheduleRulePatch,
  ProfessionalScheduleRuleResult,
  ProfessionalSession,
  ProfessionalSlot,
  ProfessionalTimeOff,
  ProfessionalTimeOffInput,
  Specialty,
} from '@/types/professional'

/** Versão dos termos do profissional (distintos dos da família; texto legal a fornecer, OP-70). */
export const PROFESSIONAL_TERMS_VERSION = '2026-11-professional-v1'

/**
 * Portal do profissional (`/professional-portal/*`, openapi.yaml tag «Professional Portal», MK1, ADR-037).
 *
 * Fatia F do plano: **só backend simulado** (`mocks/handlers/professionalPortal.ts`). A ligação à API real
 * (cliente HTTP próprio, cookie `professional_refresh_token`, token só em memória, `multipart` nas
 * credenciais) entra depois, seguindo `clinicPortal.service.ts`; as assinaturas abaixo já são as do contrato.
 * Nenhuma função recebe ids de conta: o profissional vem sempre da sessão.
 */
export const professionalPortalService = {
  register: (input: Omit<ProfessionalRegisterInput, 'termsVersion'>) =>
    mock.professionalRegister({ ...input, termsVersion: PROFESSIONAL_TERMS_VERSION }),
  verifyEmail: (email: string, code: string) => mock.professionalVerifyEmail(email, code),
  resendVerification: (email: string) => mock.professionalResendVerification(email),
  login: (email: string, password: string): Promise<ProfessionalSession> => mock.professionalLogin(email, password),
  restore: (): Promise<ProfessionalSession | null> => mock.professionalRestore(),
  logout: () => mock.professionalLogout(),
  forgotPassword: (email: string) => mock.professionalForgotPassword(email),
  resetPassword: (email: string, code: string, newPassword: string) => mock.professionalResetPassword(email, code, newPassword),

  getMe: (): Promise<ProfessionalProfile> => mock.getProfessionalMe(),
  updateMe: (patch: ProfessionalProfilePatch): Promise<ProfessionalProfile> => mock.updateProfessionalMe(patch),
  listSpecialtyCatalog: (): Promise<Specialty[]> => mock.listProfessionalSpecialtyCatalog(),
  setSpecialties: (specialtyIds: string[]): Promise<ProfessionalProfile> => mock.setProfessionalSpecialties(specialtyIds),

  listCredentials: (): Promise<ProfessionalCredential[]> => mock.listProfessionalCredentials(),
  uploadCredential: (input: CredentialUploadInput): Promise<ProfessionalCredential> => mock.uploadProfessionalCredential(input),
  deleteCredential: (credentialId: string): Promise<void> => mock.deleteProfessionalCredential(credentialId),
  downloadCredential: (credentialId: string): Promise<Blob> => mock.downloadProfessionalCredential(credentialId),

  submit: (): Promise<ProfessionalProfile> => mock.submitProfessionalForReview(),

  listOffers: (active?: boolean): Promise<ProfessionalOffer[]> => mock.listProfessionalOffers(active),
  createOffer: (input: ProfessionalOfferInput): Promise<ProfessionalOffer> => mock.createProfessionalOffer(input),
  updateOffer: (offerId: string, patch: ProfessionalOfferPatch): Promise<ProfessionalOffer> => mock.updateProfessionalOffer(offerId, patch),

  listScheduleRules: (filter?: { offerId?: string; active?: boolean }): Promise<ProfessionalScheduleRule[]> => mock.listProfessionalScheduleRules(filter),
  createScheduleRule: (input: ProfessionalScheduleRuleInput): Promise<ProfessionalScheduleRuleResult> => mock.createProfessionalScheduleRule(input),
  updateScheduleRule: (ruleId: string, patch: ProfessionalScheduleRulePatch): Promise<ProfessionalScheduleRuleResult> =>
    mock.updateProfessionalScheduleRule(ruleId, patch),

  listTimeOff: (range?: { from?: string; to?: string }): Promise<ProfessionalTimeOff[]> => mock.listProfessionalTimeOff(range),
  createTimeOff: (input: ProfessionalTimeOffInput): Promise<ProfessionalTimeOff> => mock.createProfessionalTimeOff(input),
  deleteTimeOff: (timeOffId: string): Promise<void> => mock.deleteProfessionalTimeOff(timeOffId),

  listSlots: (from: string, to: string): Promise<ProfessionalSlot[]> => mock.listProfessionalSlots(from, to),
}
