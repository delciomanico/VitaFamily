import * as mock from '@/mocks/handlers/recordSharing'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { nullsToUndefined } from '@/lib/professionalApiClient'
import type { Page } from '@/types/marketplace'
import type { CreateRecordShareInput, RecordShare, RecordShareOptions, RecordShareStatus, RecordShareView } from '@/types/recordSharing'

/**
 * Partilha de registos com prazo, do lado da família (`/families/{f}/members/{m}/record-shares*`, MK4). Só o titular
 * (`SELF`) e o tutor partilham em nome do membro (ação `SHARE_WITH_PROFESSIONALS`). O conteúdo dos registos nunca
 * passa por aqui: a família só vê metadados e o registo de acessos.
 */
const base = (familyId: string, memberId: string) => `/families/${encodeURIComponent(familyId)}/members/${encodeURIComponent(memberId)}/record-shares`
const call = <T>(path: string, options?: { method?: string; body?: unknown }) => apiFetch<unknown>(path, options).then((data) => nullsToUndefined<T>(data))
const id = encodeURIComponent
const pageOf = <T>(page: Page<T>): Page<T> => ({ items: page.items, nextCursor: page.nextCursor ?? null })

const mockImpl = {
  options: (familyId: string, userId: string, memberId: string, bookingId: string): Promise<RecordShareOptions> => mock.getRecordShareOptions(familyId, userId, memberId, bookingId),
  create: (familyId: string, userId: string, memberId: string, input: CreateRecordShareInput): Promise<RecordShare> => mock.createRecordShare(familyId, userId, memberId, input),
  list: (familyId: string, userId: string, memberId: string, query?: { bookingId?: string; status?: RecordShareStatus; cursor?: string }): Promise<Page<RecordShare>> =>
    mock.listRecordShares(familyId, userId, memberId, query),
  get: (familyId: string, userId: string, memberId: string, shareId: string): Promise<RecordShare> => mock.getRecordShare(familyId, userId, memberId, shareId),
  revoke: (familyId: string, userId: string, memberId: string, shareId: string): Promise<RecordShare> => mock.revokeRecordShare(familyId, userId, memberId, shareId),
  views: (familyId: string, userId: string, memberId: string, shareId: string, cursor?: string): Promise<Page<RecordShareView>> => mock.listRecordShareViews(familyId, userId, memberId, shareId, { cursor }),
}

const apiImpl: typeof mockImpl = {
  options: (familyId, _userId, memberId, bookingId) => call<RecordShareOptions>(`${base(familyId, memberId)}/options?bookingId=${id(bookingId)}`),
  create: (familyId, _userId, memberId, input) => call<RecordShare>(base(familyId, memberId), { method: 'POST', body: input }),
  list(familyId, _userId, memberId, query = {}) {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) if (value) search.set(key, value)
    const text = search.toString()
    return call<Page<RecordShare>>(`${base(familyId, memberId)}${text ? `?${text}` : ''}`).then(pageOf)
  },
  get: (familyId, _userId, memberId, shareId) => call<RecordShare>(`${base(familyId, memberId)}/${id(shareId)}`),
  revoke: (familyId, _userId, memberId, shareId) => call<RecordShare>(`${base(familyId, memberId)}/${id(shareId)}/revoke`, { method: 'POST' }),
  views: (familyId, _userId, memberId, shareId, cursor) =>
    call<Page<RecordShareView>>(`${base(familyId, memberId)}/${id(shareId)}/views${cursor ? `?cursor=${id(cursor)}` : ''}`).then(pageOf),
}

export const recordShareService = hasApiBackend() ? apiImpl : mockImpl
