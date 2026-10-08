// Vista `Member` (components.schemas.Member, openapi.yaml): combina FamilyMember com campos
// derivados (isMinor, hasAccount, isSelf) e a tutela (primaryGuardianId/guardianIds).
import { ageInYears, hasAccount, isMinor, MIN_ADULT_AGE, type FamilyMember } from "../domain/member.js";
import type { Guardianship } from "../domain/guardianship.js";

export interface MemberView {
  id: string;
  familyId: string;
  name: string;
  birthDate: string;
  isMinor: boolean;
  isDependent: boolean;
  hasAccount: boolean;
  role?: FamilyMember["role"];
  status: FamilyMember["status"];
  isSelf: boolean;
  primaryGuardianId?: string;
  guardianIds: string[];
  scheduledDeletionAt?: Date;
}

export function toMemberView(
  member: FamilyMember,
  now: Date,
  actorMemberId: string,
  guardianships: Guardianship[],
): MemberView {
  const primary = guardianships.find((g) => g.isPrimary);
  const view: MemberView = {
    id: member.id,
    familyId: member.familyId,
    name: member.name,
    birthDate: member.birthDate,
    isMinor: isMinor(member.birthDate, now),
    isDependent: member.isDependent,
    hasAccount: hasAccount(member),
    status: member.status,
    isSelf: member.id === actorMemberId,
    guardianIds: guardianships.map((g) => g.guardianId),
  };
  if (member.role !== undefined) {
    view.role = member.role;
  }
  if (primary) {
    view.primaryGuardianId = primary.guardianId;
  }
  if (member.scheduledDeletionAt !== undefined) {
    view.scheduledDeletionAt = member.scheduledDeletionAt;
  }
  return view;
}

/** Reexportado para quem só precisa da idade adulta mínima (ex.: validações de tutor). */
export { MIN_ADULT_AGE, ageInYears };
