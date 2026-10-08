// Mapeamento das vistas da application -> forma da API (components.schemas, openapi.yaml).
import type { Guardianship } from "../domain/guardianship.js";
import type { FamilyView } from "../application/family-view.js";
import type { InvitationPreview } from "../application/lookup-invitation.js";
import type { InvitationView } from "../application/invitation-view.js";
import type { LeaveFamilyResult } from "../application/leave-family.js";
import type { MemberView } from "../application/member-view.js";

export function toFamilyResponse(view: FamilyView) {
  return {
    id: view.id,
    name: view.name,
    myRole: view.myRole,
    createdAt: view.createdAt.toISOString(),
  };
}

export function toMemberResponse(view: MemberView) {
  return {
    id: view.id,
    familyId: view.familyId,
    name: view.name,
    birthDate: view.birthDate,
    isMinor: view.isMinor,
    isDependent: view.isDependent,
    hasAccount: view.hasAccount,
    role: view.role ?? null,
    status: view.status,
    isSelf: view.isSelf,
    primaryGuardianId: view.primaryGuardianId ?? null,
    guardianIds: view.guardianIds,
    scheduledDeletionAt: view.scheduledDeletionAt ? view.scheduledDeletionAt.toISOString() : null,
  };
}

export function toGuardianshipResponse(guardianship: Guardianship) {
  return {
    dependentId: guardianship.dependentId,
    guardianId: guardianship.guardianId,
    isPrimary: guardianship.isPrimary,
  };
}

export function toInvitationResponse(view: InvitationView) {
  return {
    id: view.id,
    familyId: view.familyId,
    email: view.email,
    type: view.type,
    status: view.status,
    expiresAt: view.expiresAt.toISOString(),
    memberId: view.memberId ?? null,
  };
}

export function toInvitationPreviewResponse(preview: InvitationPreview) {
  return {
    familyName: preview.familyName,
    invitedEmail: preview.invitedEmail,
    type: preview.type,
    expiresAt: preview.expiresAt.toISOString(),
  };
}

export function toLeaveFamilyResultResponse(result: LeaveFamilyResult) {
  return { dataExportId: result.dataExportId };
}
