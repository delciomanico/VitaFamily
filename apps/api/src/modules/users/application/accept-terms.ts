// B6/BR-ACC-03: regista a aceitação da versão atual dos termos. `termsVersion` do pedido tem de
// coincidir com a versão configurada (`TERMS_VERSION`) — não se aceita uma versão antiga/futura.
import { ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import type { UsersDeps } from "./ports.js";

export function createAcceptTermsUseCase<Trx>(deps: UsersDeps<Trx>) {
  return async function acceptTerms(
    userId: string,
    termsVersion: string,
    context: { requestId: string; ip?: string; userAgent?: string },
  ): Promise<void> {
    if (termsVersion !== deps.currentTermsVersion) {
      throw new ValidationError(
        [{ field: "termsVersion", message: "não corresponde à versão atual" }],
        { detail: "Versão dos termos inválida." },
      );
    }

    await deps.withTransaction(async (trx) => {
      await deps.usersRepo.updateTermsAcceptance(trx, userId, termsVersion, deps.clock.now());
      await deps.audit.record(trx, {
        occurredAt: deps.clock.now(),
        actorType: "USER",
        actorUserId: userId,
        action: "USER_TERMS_ACCEPTED",
        resourceType: "User",
        resourceId: userId,
        result: "SUCCESS",
        requestId: context.requestId,
        metadata: { termsVersion },
        ...auditContextFields(context),
      });
    });
  };
}
