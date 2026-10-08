// UC-PRV-02: "O que foi partilhado comigo." openapi.yaml `sharedWithMe`: "Autorização: FAM_MEMBER" —
// só exige pertença à família (VIEW_SHARED_WITH_ME), sem relação/categoria específica.
import type { ActorIdentity } from "./get-sharing.js";
import type { AccessPolicy } from "./policy.js";
import type { AccessDeps } from "./ports.js";
import { toSharedWithMeView, type SharedWithMeItemView } from "./sharing-view.js";

export function createSharedWithMeUseCase<Trx>(deps: AccessDeps<Trx>, policy: AccessPolicy<Trx>) {
  return async function sharedWithMe(actor: ActorIdentity, familyId: string): Promise<SharedWithMeItemView[]> {
    const resolved = await policy.can(deps.db, {
      userId: actor.userId,
      platformAdmin: actor.platformAdmin,
      familyId,
      action: "VIEW_SHARED_WITH_ME",
    });

    const grants = (await deps.sharingGrantsRepo.listForGrantee(deps.db, familyId, resolved.actor.id)).filter(
      (grant) => grant.ownerMemberId !== resolved.actor.id,
    );

    const ownerNames = new Map<string, string>();
    for (const ownerId of new Set(grants.map((grant) => grant.ownerMemberId))) {
      const owner = await deps.familiesPort.findMemberById(deps.db, familyId, ownerId);
      if (owner) {
        ownerNames.set(ownerId, owner.name);
      }
    }

    return toSharedWithMeView(grants, ownerNames);
  };
}
