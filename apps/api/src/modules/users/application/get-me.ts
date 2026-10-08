// UC-ACC-04 (ver também getMe no contrato): devolve a conta do próprio. Sem escrita -> sem
// transação nem auditoria (audit.md: não se audita leitura do titular sobre os seus dados).
import { NotFoundError } from "../../../platform/errors/index.js";
import { termsReacceptanceRequired, type User } from "../domain/user.js";
import type { UsersDeps } from "./ports.js";

export interface UserView extends User {
  termsReacceptanceRequired: boolean;
}

export function createGetMeUseCase<Trx>(deps: UsersDeps<Trx>) {
  return async function getMe(userId: string): Promise<UserView> {
    const user = await deps.usersRepo.findById(deps.db, userId);
    if (!user) {
      throw new NotFoundError();
    }
    return {
      ...user,
      termsReacceptanceRequired: termsReacceptanceRequired(user, deps.currentTermsVersion),
    };
  };
}
