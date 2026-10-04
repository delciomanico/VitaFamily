import * as api from '@/mocks/handlers/family'

export type { NewMemberInput } from '@/mocks/handlers/family'

/** Família e membros. Hoje mock; depois /api/v1/families/*. */
export const familyService = {
  getMembership: api.getMembership,
  createFamily: api.createFamily,
  joinFamily: api.joinFamily,
  listMembers: api.listMembers,
  listManagedMembers: api.listManagedMembers,
  addMember: api.addMember,
  removeMember: api.removeMember,
}
