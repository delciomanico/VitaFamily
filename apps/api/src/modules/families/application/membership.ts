// Helpers partilhados pelos casos de uso (não são "domain" porque fazem I/O via repositório).
// authorization.md §2/§3: a pertença do actor (FamilyMember com conta ligada) é a MESMA
// verificação que decide 404 vs. 403 (nunca enumerar outra família) — por isso só existe este
// caminho para resolver o actor.
import { DomainError, ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import { hasAccount, isEligibleGuardian, isMinor, type FamilyMember } from "../domain/member.js";
import type { FamiliesDeps } from "./ports.js";

export { isEligibleGuardian };

/**
 * authorization.md §2 passo 3: o actor tem de ter FamilyMember com conta ligada na família do
 * pedido; caso contrário `NOT_FOUND` (nunca revela se a família existe ou se só não é membro).
 */
export async function requireMembership<Trx>(
  deps: FamiliesDeps<Trx>,
  trx: Trx,
  familyId: string,
  userId: string,
): Promise<FamilyMember> {
  const member = await deps.membersRepo.findByUserId(trx, familyId, userId);
  if (!member) {
    throw new NotFoundError({ detail: "Família não encontrada." });
  }
  return member;
}

/** authorization.md §4: ação estrutural exige Family Admin. */
export function requireAdmin(member: FamilyMember): void {
  if (member.role !== "FAMILY_ADMIN") {
    throw new ForbiddenError({ detail: "Requer Family Admin." });
  }
}

/** Membro-alvo (sujeito da ação) dentro da MESMA família — 404 se não existir aqui. */
export async function requireMemberRecord<Trx>(
  deps: FamiliesDeps<Trx>,
  trx: Trx,
  familyId: string,
  memberId: string,
): Promise<FamilyMember> {
  const target = await deps.membersRepo.findById(trx, familyId, memberId);
  if (!target) {
    throw new NotFoundError({ detail: "Membro não encontrado." });
  }
  return target;
}

/** BR-FAM-02: a família nunca pode ficar sem Family Admin. */
export async function assertNotLastAdmin<Trx>(
  deps: FamiliesDeps<Trx>,
  trx: Trx,
  familyId: string,
): Promise<void> {
  const admins = await deps.membersRepo.countActiveAdmins(trx, familyId);
  if (admins <= 1) {
    throw new DomainError("LAST_ADMIN", { detail: "A família ficaria sem Family Admin." });
  }
}

/** BR-MEM-07/P8: um dependente nunca pode ficar sem tutor; verifica antes de remover `guardianId`. */
export async function assertNotLastGuardian<Trx>(
  deps: FamiliesDeps<Trx>,
  trx: Trx,
  familyId: string,
  guardianId: string,
): Promise<void> {
  const dependencies = await deps.guardianshipsRepo.listByGuardian(trx, familyId, guardianId);
  for (const dependency of dependencies) {
    const guardians = await deps.guardianshipsRepo.listByDependent(trx, familyId, dependency.dependentId);
    if (guardians.length <= 1) {
      throw new DomainError("LAST_GUARDIAN", { detail: "O dependente ficaria sem tutor." });
    }
  }
}

/**
 * authorization.md §4 ("Admin ou titular ou tutor"): o actor pode agir sobre `target` se for
 * Family Admin, o próprio (`SELF`), ou tutor de `target` (`TUTOR_OF`, BR-MEM-08).
 */
export async function assertCanActOnMember<Trx>(
  deps: FamiliesDeps<Trx>,
  trx: Trx,
  actor: FamilyMember,
  target: FamilyMember,
): Promise<void> {
  if (actor.role === "FAMILY_ADMIN") {
    return;
  }
  if (actor.id === target.id) {
    return;
  }
  const guardianship = await deps.guardianshipsRepo.find(trx, target.familyId, target.id, actor.id);
  if (guardianship) {
    return;
  }
  throw new ForbiddenError({ detail: "Sem permissão sobre este membro." });
}

/**
 * authorization.md §4 ("FAM_ADMIN ou titular, se adulto com conta"): usado por `addGuardian`,
 * `removeGuardian`, `setPrimaryGuardian` — sem a exceção de tutor de `assertCanActOnMember`.
 */
export function assertCanManageGuardians(actor: FamilyMember, target: FamilyMember, now: Date): void {
  if (actor.role === "FAMILY_ADMIN") {
    return;
  }
  if (actor.id === target.id && !isMinor(target.birthDate, now) && hasAccount(target)) {
    return;
  }
  throw new ForbiddenError({ detail: "Sem permissão para gerir tutores." });
}

/** BR-MEM-05: tutor adulto, com conta, da mesma família que `familyId` (garantido pelo repositório). */
export function assertEligibleGuardian(candidate: FamilyMember, dependentId: string, now: Date): void {
  if (candidate.id === dependentId) {
    throw new DomainError("GUARDIAN_INVALID", { detail: "O tutor não pode ser o próprio dependente." });
  }
  if (!isEligibleGuardian(candidate, now)) {
    throw new DomainError("GUARDIAN_INVALID", { detail: "O tutor tem de ser adulto e ter conta." });
  }
}
