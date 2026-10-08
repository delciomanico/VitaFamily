// UC-FAM-03/FR-FAM-04: alterar o nome da família (FAM_ADMIN).
import { ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { requireAdmin, requireMembership } from "./membership.js";
import { toFamilyView, type FamilyView } from "./family-view.js";

export interface UpdateFamilyInput {
  name: string;
}

export function createUpdateFamilyUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function updateFamily(
    userId: string,
    familyId: string,
    input: UpdateFamilyInput,
    context: RequestContext,
  ): Promise<FamilyView> {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new ValidationError([{ field: "name", message: "não pode ser vazio" }], {
        detail: "Nome inválido.",
      });
    }

    return deps.withTransaction(async (trx) => {
      const member = await requireMembership(deps, trx, familyId, userId);
      requireAdmin(member);

      const family = await deps.familiesRepo.updateName(trx, familyId, name);

      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: userId,
        action: "FAMILY_UPDATE",
        resourceType: "Family",
        resourceId: familyId,
        familyId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return toFamilyView(family, "FAMILY_ADMIN");
    });
  };
}
