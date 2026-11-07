import * as mock from '@/mocks/handlers/clinicConsents'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import type { ConsentLevel } from '@/types/clinic'
import type { ClinicConsent, ClinicLinkCode } from '@/types/clinicConsent'

/**
 * Consentimento por clínica e código de ligação, do lado da família (M14 P, BR-CLN-19/20): só o
 * titular adulto ou o tutor (authorization.md §6.4). Com a API real o utilizador vem do token.
 */

const base = (familyId: string, memberId: string) => `/families/${familyId}/members/${memberId}`

const apiImpl = {
  list: (familyId: string, _userId: string, memberId: string) =>
    apiFetch<ClinicConsent[]>(`${base(familyId, memberId)}/clinic-consents`),
  put: (familyId: string, _userId: string, memberId: string, clinicId: string, level: ConsentLevel) =>
    apiFetch<ClinicConsent>(`${base(familyId, memberId)}/clinic-consents/${clinicId}`, {
      method: 'PUT',
      body: { level },
    }),
  revoke: (familyId: string, _userId: string, memberId: string, clinicId: string) =>
    apiFetch<void>(`${base(familyId, memberId)}/clinic-consents/${clinicId}`, { method: 'DELETE' }),
  createLinkCode: (familyId: string, _userId: string, memberId: string) =>
    apiFetch<ClinicLinkCode>(`${base(familyId, memberId)}/clinic-link-codes`, { method: 'POST' }),
}

const mockImpl: typeof apiImpl = {
  list: (familyId, userId, memberId) => mock.listClinicConsents(familyId, userId, memberId),
  put: (familyId, userId, memberId, clinicId, level) => mock.putClinicConsent(familyId, userId, memberId, clinicId, level),
  revoke: (familyId, userId, memberId, clinicId) => mock.revokeClinicConsent(familyId, userId, memberId, clinicId),
  createLinkCode: (familyId, userId, memberId) => mock.createClinicLinkCode(familyId, userId, memberId),
}

export const clinicConsentService = hasApiBackend() ? apiImpl : mockImpl
