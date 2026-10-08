// Mapeamento das vistas da application -> forma da API (components.schemas, openapi.yaml).
import type { SharedWithMeItemView, SharingSettingsView } from "../application/sharing-view.js";

export function toSharingSettingsResponse(view: SharingSettingsView) {
  return {
    grants: view.grants.map((grant) => ({
      category: grant.category,
      granteeMemberId: grant.granteeMemberId ?? null,
    })),
  };
}

export function toSharedWithMeResponse(items: SharedWithMeItemView[]) {
  return items.map((item) => ({
    memberId: item.memberId,
    memberName: item.memberName,
    categories: item.categories,
  }));
}
