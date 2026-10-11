import * as api from '@/mocks/handlers/family'
import * as members from '@/mocks/handlers/members'
import { apiFetch, hasApiBackend } from '@/lib/apiClient'
import { AppError } from '@/lib/errors'
import type { Family, FamilyMember, FamilyRole, Membership } from '@/types/family'

export type { NewMemberInput } from '@/mocks/handlers/family'

/** `Family` (openapi.yaml components.schemas.Family): não expõe quem criou a família. */
interface ApiFamily {
  id: string
  name: string
  myRole: FamilyRole
  createdAt: string
}

/** `Member` (openapi.yaml components.schemas.Member). */
interface ApiMember {
  id: string
  familyId: string
  name: string
  birthDate: string
  isDependent: boolean
  hasAccount: boolean
  role: FamilyRole | null
  status: 'ACTIVE' | 'BLOCKED'
  isSelf: boolean
}

function toFamily(apiFamily: ApiFamily): Family {
  // `createdBy` não existe no contrato real (Family só tem id/name/myRole/createdAt) e não é
  // lido em lado nenhum da UI além do tipo mock — não há valor correto a inventar aqui.
  return { id: apiFamily.id, name: apiFamily.name, createdBy: '' }
}

function toFamilyMember(apiMember: ApiMember): FamilyMember {
  return {
    id: apiMember.id,
    familyId: apiMember.familyId,
    name: apiMember.name,
    birthDate: apiMember.birthDate,
    role: apiMember.role ?? undefined,
    isDependent: apiMember.isDependent,
    status: apiMember.status,
    // TBD (types/family.ts): `relationship`/`sex`/`bloodType` não existem no contrato; `userId`
    // também não (o contrato usa `hasAccount`) — por agora não mapeados para a API real.
  }
}

/** Busca o próprio membro (`isSelf`) de uma família já criada/associada ao utilizador autenticado. */
async function fetchSelfMember(familyId: string): Promise<FamilyMember> {
  const list = await apiFetch<ApiMember[]>(`/families/${familyId}/members`)
  const self = list.find((m) => m.isSelf)
  if (!self) throw new AppError('NOT_FOUND')
  return toFamilyMember(self)
}

/** UC-FAM-02 (API real): usa a primeira família da lista (MVP de um só contexto por utilizador). */
async function apiGetMembership(): Promise<Membership | null> {
  const list = await apiFetch<ApiFamily[]>('/families')
  const first = list[0]
  if (!first) return null
  return { family: toFamily(first), member: await fetchSelfMember(first.id) }
}

/** UC-FAM-01 (API real): `POST /families` cria a família e o FamilyMember Admin do utilizador. */
async function apiCreateFamily(name: string): Promise<Membership> {
  const created = await apiFetch<ApiFamily>('/families', { method: 'POST', body: { name } })
  return { family: toFamily(created), member: await fetchSelfMember(created.id) }
}

/** `InvitationPreview` (openapi.yaml): dados mínimos mostrados antes de aceitar um convite. */
export interface InvitationPreview {
  familyName: string
  invitedEmail: string
  type: 'MEMBER' | 'DEPENDENT_ACCOUNT'
  expiresAt: string
}

/**
 * `POST /invitations/lookup` (API real, PUBLIC): preview do convite a partir do token do link
 * `/invite/accept?token=...`. Não existe no contrato um "código" de convite — só este fluxo.
 */
async function apiLookupInvitation(token: string): Promise<InvitationPreview> {
  return apiFetch<InvitationPreview>('/invitations/lookup', { method: 'POST', body: { token }, auth: false })
}

/**
 * `POST /invitations/accept` (API real, AUTH): aceita o convite para o utilizador já autenticado.
 * Devolve só o `Member` criado — quem chama deve recarregar a família a seguir (`getMembership`),
 * tal como `AuthContext.acceptInvitation` faz.
 */
async function apiAcceptInvitation(token: string): Promise<void> {
  await apiFetch<ApiMember>('/invitations/accept', { method: 'POST', body: { token } })
}

/**
 * Família e membros. Com `VITE_API_URL` definido, criar/consultar a família usa a API real
 * (docs/05-api/openapi.yaml); sem backend configurado cai nos mocks (auth.service.ts, mesmo padrão).
 *
 * NOTA (divergência não resolvida — reportar, não inventar): `listMembers`/`addMember`/
 * `removeMember`/`updateFamily`/`getFamilyOverview`/`getMemberProfile`/`getMemberHistory`
 * continuam só em mock. `joinFamily` (código de convite genérico) já não corresponde ao contrato
 * real — mantido apenas porque outros testes de mocks (`mocks/handlers/*.test.ts`) ainda o chamam
 * diretamente; a UI usa agora `lookupInvitation`/`acceptInvitation` (convite por e-mail + token,
 * `/invitations/lookup` e `/invitations/accept`), ligadas à tela `/invite/accept`.
 */
export const familyService = {
  getMembership: hasApiBackend() ? (_userId: string) => apiGetMembership() : api.getMembership,
  createFamily: hasApiBackend() ? (_userId: string, name: string) => apiCreateFamily(name) : api.createFamily,
  lookupInvitation: hasApiBackend() ? apiLookupInvitation : api.lookupInvitationByToken,
  acceptInvitation: hasApiBackend()
    ? (_userId: string, token: string) => apiAcceptInvitation(token)
    : async (userId: string, token: string) => {
        await api.acceptInvitationByToken(userId, token)
      },
  joinFamily: api.joinFamily,
  listMembers: api.listMembers,
  listManagedMembers: api.listManagedMembers,
  addMember: api.addMember,
  removeMember: api.removeMember,
  updateFamily: api.updateFamily,
  getFamilyOverview: members.getFamilyOverview,
  getMemberProfile: members.getMemberProfile,
  getMemberHistory: members.getMemberHistory,
}
