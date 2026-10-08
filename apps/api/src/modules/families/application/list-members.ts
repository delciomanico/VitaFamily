// UC-FAM-05/MEM-01: listar membros da família (FAM_MEMBER). BR-PRV-10: nome e data de nascimento
// são sempre visíveis a toda a família — este módulo nunca expõe dados de saúde (P5 fica
// automaticamente satisfeito: o dependente com conta não vê mais do que isto).
import type { FamiliesDeps } from "./ports.js";
import { requireMembership } from "./membership.js";
import { toMemberView, type MemberView } from "./member-view.js";

export function createListMembersUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function listMembers(userId: string, familyId: string): Promise<MemberView[]> {
    const actor = await requireMembership(deps, deps.db, familyId, userId);
    const now = deps.clock.now();
    const members = await deps.membersRepo.listByFamily(deps.db, familyId);
    const views: MemberView[] = [];
    for (const member of members) {
      const guardianships = member.isDependent
        ? await deps.guardianshipsRepo.listByDependent(deps.db, familyId, member.id)
        : [];
      views.push(toMemberView(member, now, actor.id, guardianships));
    }
    return views;
  };
}
