import * as mock from '@/mocks/handlers/clinicAuthorizations'
import { AppError } from '@/lib/errors'
import { hasApiBackend } from '@/lib/apiClient'
import { clinicApiFetch } from '@/lib/clinicApiClient'
import { asArray } from '@/lib/safe'
import { clinicSessionStore } from '@/lib/storage'
import type { AuthorizationAttachment, AuthorizationAttachmentKind, AuthorizationRequest, AuthorizationRequestInput, Page } from '@/types/insurerOps'

/**
 * Pedidos de autorização do prestador (`/clinic-portal/authorizations*`, ADR-034). Só Admin/Gestor.
 * Nunca se enviam dados clínicos: o contrato só tem texto administrativo (C2).
 */
export interface AttachmentUpload {
  kind: AuthorizationAttachmentKind
  file: File
}

const apiImpl = {
  create: (input: AuthorizationRequestInput) => clinicApiFetch<AuthorizationRequest>('/authorizations', { method: 'POST', body: input }),
  list: async (query: { status?: string; processId?: string } = {}): Promise<Page<AuthorizationRequest>> => {
    const params = new URLSearchParams({ limit: '100' })
    if (query.status) params.set('status', query.status)
    if (query.processId) params.set('processId', query.processId)
    const page = await clinicApiFetch<Page<AuthorizationRequest>>(`/authorizations?${params}`)
    return { items: asArray(page?.items), nextCursor: page?.nextCursor ?? null }
  },
  get: (id: string) => clinicApiFetch<AuthorizationRequest>(`/authorizations/${id}`),
  respond: (id: string, message: string) => clinicApiFetch<AuthorizationRequest>(`/authorizations/${id}/respond`, { method: 'POST', body: { message } }),
  cancel: (id: string) => clinicApiFetch<AuthorizationRequest>(`/authorizations/${id}/cancel`, { method: 'POST', body: {} }),
  appeal: (id: string, input: { justification: string }) => clinicApiFetch<AuthorizationRequest>(`/authorizations/${id}/appeals`, { method: 'POST', body: input }),
  attach: (id: string, upload: AttachmentUpload) => {
    const form = new FormData()
    form.append('file', upload.file)
    form.append('kind', upload.kind)
    return clinicApiFetch<AuthorizationAttachment>(`/authorizations/${id}/attachments`, { method: 'POST', body: form })
  },
  removeAttachment: (id: string, attachmentId: string) => clinicApiFetch<void>(`/authorizations/${id}/attachments/${attachmentId}`, { method: 'DELETE' }),
}

function accountId(): string {
  const id = clinicSessionStore.getAccountId()
  if (!id) throw new AppError('INVALID_CREDENTIALS')
  return id
}

const mockImpl: typeof apiImpl = {
  create: (input) => mock.createAuthorization(accountId(), input),
  list: (query = {}) => mock.listAuthorizations(accountId(), query),
  get: (id) => mock.getAuthorization(accountId(), id),
  respond: (id, message) => mock.respondAuthorization(accountId(), id, message),
  cancel: (id) => mock.cancelAuthorization(accountId(), id),
  appeal: (id, input) => mock.appealAuthorization(accountId(), id, input),
  attach: (id, upload) => mock.addAuthorizationAttachment(accountId(), id, { kind: upload.kind, name: upload.file.name, size: upload.file.size, type: upload.file.type }),
  removeAttachment: (id, attachmentId) => mock.removeAuthorizationAttachment(accountId(), id, attachmentId),
}

export const clinicAuthorizationsService = hasApiBackend() ? apiImpl : mockImpl
