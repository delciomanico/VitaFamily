// UC-PRV-01 (escrita): definir a partilha de um membro por categoria — substitui todas as
// concessões do dono (BR-PRV-04: efeito imediato). openapi.yaml `putSharing`: "Autorização: Titular
// ou tutor. BR-PRV-01..04: só leitura; efeito imediato; destinatário nulo = toda a família."
import { newId } from "../../../platform/ids/index.js";
import { ValidationError, type FieldError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { DataCategory } from "../domain/sharing-grant.js";
import type { ActorIdentity } from "./get-sharing.js";
import type { AccessPolicy } from "./policy.js";
import type { AccessDeps, RequestContext } from "./ports.js";
import { toSharingSettingsView, type SharingSettingsView } from "./sharing-view.js";

export interface PutSharingGrantInput {
  category: DataCategory;
  /** `undefined`/`null` = toda a família (DM3). */
  granteeMemberId?: string | null;
}

export interface PutSharingInput {
  grants: PutSharingGrantInput[];
}

function dedupeKey(grant: PutSharingGrantInput): string {
  return `${grant.category}:${grant.granteeMemberId ?? "ALL"}`;
}

export function createPutSharingUseCase<Trx>(deps: AccessDeps<Trx>, policy: AccessPolicy<Trx>) {
  return async function putSharing(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: PutSharingInput,
    context: RequestContext,
  ): Promise<SharingSettingsView> {
    return deps.withTransaction(async (trx) => {
      await policy.can(trx, {
        userId: actor.userId,
        platformAdmin: actor.platformAdmin,
        familyId,
        action: "MANAGE_SHARING",
        subjectMemberId: memberId,
      });

      const fields: FieldError[] = [];
      const seen = new Set<string>();
      for (const [index, grant] of input.grants.entries()) {
        const indexLabel = String(index);
        const key = dedupeKey(grant);
        if (seen.has(key)) {
          fields.push({ field: `grants[${indexLabel}]`, message: "concessão duplicada" });
          continue;
        }
        seen.add(key);

        if (grant.granteeMemberId) {
          if (grant.granteeMemberId === memberId) {
            fields.push({ field: `grants[${indexLabel}].granteeMemberId`, message: "não pode ser o próprio titular" });
            continue;
          }
          const grantee = await deps.familiesPort.findMemberById(trx, familyId, grant.granteeMemberId);
          if (!grantee) {
            fields.push({ field: `grants[${indexLabel}].granteeMemberId`, message: "membro inexistente nesta família" });
          }
        }
      }
      if (fields.length > 0) {
        throw new ValidationError(fields, { detail: "Partilha inválida." });
      }

      const now = deps.clock.now();
      const records = input.grants.map((grant) => ({
        id: newId(),
        familyId,
        ownerMemberId: memberId,
        category: grant.category,
        grantedBy: actor.userId,
        createdAt: now,
        ...(grant.granteeMemberId ? { granteeMemberId: grant.granteeMemberId } : {}),
      }));

      const saved = await deps.sharingGrantsRepo.replaceForOwner(trx, familyId, memberId, records);

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: actor.userId,
        action: "SHARING_UPDATE",
        resourceType: "SharingGrant",
        resourceId: memberId,
        familyId,
        subjectMemberId: memberId,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { grantCount: saved.length },
        ...auditContextFields(context),
      });

      return toSharingSettingsView(saved);
    });
  };
}
