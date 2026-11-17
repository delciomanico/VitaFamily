import * as mock from '@/mocks/handlers/professionalPortal'
import { hasApiBackend } from '@/lib/apiClient'
import {
  professionalApiFetch,
  professionalApiFetchBlob,
  refreshProfessionalAccessToken,
  setProfessionalAccessToken,
  type ProfessionalTokenResponse,
} from '@/lib/professionalApiClient'
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
 * Com `VITE_API_URL` definido usa a API real (`professionalApiClient`: cookie `professional_refresh_token`,
 * `X-Requested-With` no refresh, token só em memória, `multipart` nas credenciais); sem ele, o backend
 * simulado (`mocks/handlers/professionalPortal.ts`).
 * Nenhuma função recebe ids de conta: o profissional vem sempre da sessão.
 */
const mockImpl = {
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

const query = (params: Record<string, string | boolean | undefined>): string => {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value))
  const text = search.toString()
  return text ? `?${text}` : ''
}

const json = (method: string, body: unknown) => ({ method, body })

const apiImpl: typeof mockImpl = {
  // O contrato manda e-mail + `token` (código de 6 dígitos); o registo só pede os termos do profissional.
  register: (input) =>
    professionalApiFetch<void>('/auth/register', { ...json('POST', { ...input, termsVersion: PROFESSIONAL_TERMS_VERSION }), auth: false }),
  verifyEmail: (email, code) => professionalApiFetch<void>('/auth/verify-email', { ...json('POST', { email, token: code }), auth: false }),
  resendVerification: (email) => professionalApiFetch<void>('/auth/resend-verification', { ...json('POST', { email }), auth: false }),
  async login(email, password) {
    const tokens = await professionalApiFetch<ProfessionalTokenResponse>('/auth/login', {
      ...json('POST', { email, password }),
      auth: false,
    })
    setProfessionalAccessToken(tokens.accessToken)
    return { professionalId: tokens.professionalId, email: email.trim().toLowerCase(), validationStatus: tokens.validationStatus }
  },
  /** Retoma a sessão ao abrir o portal (cookie `professional_refresh_token`); o e-mail vem do perfil. */
  async restore() {
    const tokens = await refreshProfessionalAccessToken()
    if (!tokens) return null
    try {
      const me = await professionalApiFetch<ProfessionalProfile>('/me')
      return { professionalId: tokens.professionalId, email: me.email, validationStatus: me.validationStatus }
    } catch {
      setProfessionalAccessToken(null)
      return null
    }
  },
  async logout() {
    try {
      await professionalApiFetch<void>('/auth/logout', { method: 'POST' })
    } finally {
      setProfessionalAccessToken(null)
    }
  },
  forgotPassword: (email) => professionalApiFetch<void>('/auth/password/forgot', { ...json('POST', { email }), auth: false }),
  resetPassword: (email, code, newPassword) =>
    professionalApiFetch<void>('/auth/password/reset', { ...json('POST', { email, token: code, newPassword }), auth: false }),

  getMe: () => professionalApiFetch<ProfessionalProfile>('/me'),
  updateMe: (patch) => professionalApiFetch<ProfessionalProfile>('/me', json('PATCH', patch)),
  listSpecialtyCatalog: () => professionalApiFetch<Specialty[]>('/specialties'),
  setSpecialties: (specialtyIds) => professionalApiFetch<ProfessionalProfile>('/me/specialties', json('PUT', { specialtyIds })),

  listCredentials: () => professionalApiFetch<ProfessionalCredential[]>('/credentials'),
  uploadCredential(input) {
    const form = new FormData()
    form.set('kind', input.kind)
    if (input.number) form.set('number', input.number)
    if (input.issuingBody) form.set('issuingBody', input.issuingBody)
    if (input.validUntil) form.set('validUntil', input.validUntil)
    form.set('file', input.file)
    return professionalApiFetch<ProfessionalCredential>('/credentials', { method: 'POST', body: form })
  },
  deleteCredential: (credentialId) => professionalApiFetch<void>(`/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' }),
  downloadCredential: (credentialId) => professionalApiFetchBlob(`/credentials/${encodeURIComponent(credentialId)}/file`),

  submit: () => professionalApiFetch<ProfessionalProfile>('/submission', { method: 'POST' }),

  listOffers: (active) => professionalApiFetch<ProfessionalOffer[]>(`/offers${query({ active })}`),
  createOffer: (input) => professionalApiFetch<ProfessionalOffer>('/offers', json('POST', input)),
  updateOffer: (offerId, patch) => professionalApiFetch<ProfessionalOffer>(`/offers/${encodeURIComponent(offerId)}`, json('PATCH', patch)),

  listScheduleRules: (filter) =>
    professionalApiFetch<ProfessionalScheduleRule[]>(`/schedule-rules${query({ offerId: filter?.offerId, active: filter?.active })}`),
  createScheduleRule: (input) => professionalApiFetch<ProfessionalScheduleRuleResult>('/schedule-rules', json('POST', input)),
  updateScheduleRule: (ruleId, patch) =>
    professionalApiFetch<ProfessionalScheduleRuleResult>(`/schedule-rules/${encodeURIComponent(ruleId)}`, json('PATCH', patch)),

  listTimeOff: (range) => professionalApiFetch<ProfessionalTimeOff[]>(`/time-off${query({ from: range?.from, to: range?.to })}`),
  createTimeOff: (input) => professionalApiFetch<ProfessionalTimeOff>('/time-off', json('POST', input)),
  deleteTimeOff: (timeOffId) => professionalApiFetch<void>(`/time-off/${encodeURIComponent(timeOffId)}`, { method: 'DELETE' }),

  listSlots: (from, to) => professionalApiFetch<ProfessionalSlot[]>(`/slots${query({ from, to })}`),
}

export const professionalPortalService = hasApiBackend() ? apiImpl : mockImpl
