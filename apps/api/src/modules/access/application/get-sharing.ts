// UC-PRV-01 (leitura): ver a partilha de um membro por categoria. openapi.yaml `getSharing`:
// "Autorização: Titular ou tutor" — mesma decisão de `putSharing` (MANAGE_SHARING).
import type { AccessPolicy } from "./policy.js";
import type { AccessDeps } from "./ports.js";
import { toSharingSettingsView, type SharingSettingsView } from "./sharing-view.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

export function createGetSharingUseCase<Trx>(deps: AccessDeps<Trx>, policy: AccessPolicy<Trx>) {
  return async function getSharing(actor: ActorIdentity, familyId: string, memberId: string): Promise<SharingSettingsView> {
    await policy.can(deps.db, {
      userId: actor.userId,
      platformAdmin: actor.platformAdmin,
      familyId,
      action: "MANAGE_SHARING",
      subjectMemberId: memberId,
    });
    const grants = await deps.sharingGrantsRepo.listByOwner(deps.db, familyId, memberId);
    return toSharingSettingsView(grants);
  };
}
