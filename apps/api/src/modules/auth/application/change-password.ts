// FR-AUTH (derivado): altera a palavra-passe estando autenticado; revoga as outras sessões
// (openapi.yaml: changePassword — só documenta 401/422; nunca 404, por isso uma conta
// desaparecida a meio do pedido também é UNAUTHENTICATED, não NOT_FOUND).
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { InvalidCredentialsError } from "../domain/errors.js";
import { assertPasswordPolicy, hashPassword, verifyPassword } from "../domain/password.js";
import type { AuthDeps, RequestContext } from "./ports.js";

export function createChangePasswordUseCase<Trx>(deps: AuthDeps<Trx>) {
  return async function changePassword(
    userId: string,
    currentSessionId: string,
    input: { currentPassword: string; newPassword: string },
    context: RequestContext,
  ): Promise<void> {
    const now = deps.clock.now();
    const user = await deps.usersPort.byId(deps.db, userId);
    if (!user) {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }

    const currentOk = await verifyPassword(user.passwordHash, input.currentPassword);
    if (!currentOk) {
      throw new InvalidCredentialsError();
    }
    assertPasswordPolicy(input.newPassword);

    const passwordHash = await hashPassword(input.newPassword);
    await deps.withTransaction(async (trx) => {
      await deps.usersPort.setPasswordHash(trx, userId, passwordHash);
      await deps.sessionRepo.revokeAllForUserExcept(trx, userId, currentSessionId, now);
      await deps.audit.record(trx, {
        occurredAt: now,
        actorType: "USER",
        actorUserId: userId,
        action: "AUTH_PASSWORD_CHANGE",
        resourceType: "User",
        resourceId: userId,
        result: "SUCCESS",
        requestId: context.requestId,
        ...auditContextFields(context),
      });
    });
  };
}
