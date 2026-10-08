// UC-ACC-04: altera nome e fuso horário. Mudar o fuso reprograma tomas futuras (BR-MED-08) — fora
// do âmbito de M1 (módulo `medications` ainda não existe); fica para quando esse módulo existir.
import { ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { assertValidTimezone } from "../domain/user.js";
import type { UserView } from "./get-me.js";
import type { UsersDeps } from "./ports.js";
import { termsReacceptanceRequired } from "../domain/user.js";

export interface UpdateMeInput {
  name?: string;
  timezone?: string;
}

export function createUpdateMeUseCase<Trx>(deps: UsersDeps<Trx>) {
  return async function updateMe(
    userId: string,
    input: UpdateMeInput,
    context: { requestId: string; ip?: string; userAgent?: string },
  ): Promise<UserView> {
    if (input.name?.trim().length === 0) {
      throw new ValidationError([{ field: "name", message: "não pode ser vazio" }], {
        detail: "Dados inválidos.",
      });
    }
    if (input.timezone !== undefined) {
      assertValidTimezone(input.timezone);
    }

    const updated = await deps.withTransaction(async (trx) => {
      const user = await deps.usersRepo.updateProfile(trx, userId, input);
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: userId,
        action: "USER_UPDATE",
        resourceType: "User",
        resourceId: userId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
      return user;
    });

    return {
      ...updated,
      termsReacceptanceRequired: termsReacceptanceRequired(updated, deps.currentTermsVersion),
    };
  };
}
