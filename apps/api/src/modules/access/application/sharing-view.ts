// DTOs internos (application -> interface, mesmo padrão de `families/application/member-view.ts`).
import type { DataCategory, SharingGrant } from "../domain/sharing-grant.js";

export interface SharingGrantView {
  category: DataCategory;
  granteeMemberId?: string;
}

export interface SharingSettingsView {
  grants: SharingGrantView[];
}

export function toSharingSettingsView(grants: SharingGrant[]): SharingSettingsView {
  return {
    grants: grants.map((grant) => ({
      category: grant.category,
      ...(grant.granteeMemberId !== undefined ? { granteeMemberId: grant.granteeMemberId } : {}),
    })),
  };
}

export interface SharedWithMeItemView {
  memberId: string;
  memberName: string;
  categories: DataCategory[];
}

/** UC-PRV-02: agrupa as concessões recebidas por titular (dono), com as categorias partilhadas. */
export function toSharedWithMeView(grants: SharingGrant[], ownerNames: Map<string, string>): SharedWithMeItemView[] {
  const byOwner = new Map<string, Set<DataCategory>>();
  for (const grant of grants) {
    const categories = byOwner.get(grant.ownerMemberId) ?? new Set<DataCategory>();
    categories.add(grant.category);
    byOwner.set(grant.ownerMemberId, categories);
  }
  return [...byOwner.entries()].map(([memberId, categories]) => ({
    memberId,
    memberName: ownerNames.get(memberId) ?? "",
    categories: [...categories],
  }));
}
