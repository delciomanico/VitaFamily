import { apiFetch } from '@/lib/apiClient'
import { AppError } from '@/lib/errors'

/** Membro mínimo (openapi.yaml components.schemas.Member) usado para percorrer recursos por membro. */
export interface ApiMemberRef {
  id: string
  name: string
  isSelf: boolean
  status: 'ACTIVE' | 'BLOCKED'
}

/**
 * Os recursos da API vivem em `/families/{f}/members/{m}/…`, enquanto a UI lista/abre por id.
 * Estes helpers percorrem os membros ativos; 403/404 de um membro (sem partilha) são ignorados.
 */
export async function listActiveMembers(familyId: string): Promise<ApiMemberRef[]> {
  const members = await apiFetch<ApiMemberRef[]>(`/families/${familyId}/members`)
  return members.filter((m) => m.status === 'ACTIVE')
}

/** Lista `{items}` de cada membro, junta tudo e anota cada item com o seu membro. */
export async function collectPerMember<T>(
  familyId: string,
  path: (memberId: string) => string,
): Promise<Array<{ member: ApiMemberRef; item: T }>> {
  const members = await listActiveMembers(familyId)
  const lists = await Promise.all(
    members.map((member) =>
      apiFetch<{ items: T[] }>(path(member.id))
        .then((page) => page.items.map((item) => ({ member, item })))
        .catch(() => [] as Array<{ member: ApiMemberRef; item: T }>),
    ),
  )
  return lists.flat()
}

/** Procura um recurso por id nos membros da família (NOT_FOUND se nenhum o devolver). */
export async function findPerMember<T>(
  familyId: string,
  path: (memberId: string) => string,
): Promise<{ member: ApiMemberRef; item: T }> {
  const members = await listActiveMembers(familyId)
  const results = await Promise.all(
    members.map((member) =>
      apiFetch<T>(path(member.id))
        .then((item) => ({ member, item }))
        .catch(() => null),
    ),
  )
  const found = results.find((r) => r !== null)
  if (!found) throw new AppError('NOT_FOUND')
  return found
}
