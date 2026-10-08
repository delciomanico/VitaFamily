// UC-FAM-01/FR-FAM-01: criar família. Cria a Family e o FamilyMember do próprio User como
// FAMILY_ADMIN, na mesma transação (BR-FAM-01).
import { newId } from "../../../platform/ids/index.js";
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { MAX_FAMILIES_PER_USER } from "../domain/family.js";
import type { FamiliesDeps, RequestContext } from "./ports.js";
import { toFamilyView, type FamilyView } from "./family-view.js";

export interface CreateFamilyInput {
  name: string;
}

export function createCreateFamilyUseCase<Trx>(deps: FamiliesDeps<Trx>) {
  return async function createFamily(
    userId: string,
    input: CreateFamilyInput,
    context: RequestContext,
  ): Promise<FamilyView> {
    const name = input.name.trim();
    if (name.length === 0) {
      throw new ValidationError([{ field: "name", message: "não pode ser vazio" }], {
        detail: "Nome inválido.",
      });
    }

    return deps.withTransaction(async (trx) => {
      const existingCount = await deps.familiesRepo.countForUser(trx, userId);
      if (existingCount >= MAX_FAMILIES_PER_USER) {
        throw new DomainError("LIMIT_EXCEEDED", { detail: "Limite de famílias atingido." });
      }

      const user = await deps.usersPort.byId(trx, userId);
      if (!user) {
        throw new DomainError("NOT_FOUND", { detail: "Utilizador não encontrado." });
      }

      const now = deps.clock.now();
      const family = await deps.familiesRepo.insert(trx, {
        id: newId(),
        name,
        createdBy: userId,
        createdAt: now,
      });
      await deps.membersRepo.insert(trx, {
        id: newId(),
        familyId: family.id,
        userId,
        name: user.name,
        birthDate: user.birthDate,
        role: "FAMILY_ADMIN",
        isDependent: false,
        createdAt: now,
      });

      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "FAMILY_CREATE",
        resourceType: "Family",
        resourceId: family.id,
        familyId: family.id,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });

      return toFamilyView(family, "FAMILY_ADMIN");
    });
  };
}
