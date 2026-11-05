// Estado da conta do portal por pedido, com cache ≤60 s (authorization.md §8.1 passo 1): conta
// suspensa OU seguradora suspensa (BR-INS-10) ⇒ `suspended`.
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { InsuranceAccountRole, InsuranceDeps } from "./ports.js";

export interface InsuranceActorState {
  insuranceAccountId: string;
  sessionId: string;
  insurerId: string;
  role: InsuranceAccountRole;
  suspended: boolean;
}

export function createResolveInsuranceActorStateUseCase<Trx>(deps: InsuranceDeps<Trx>) {
  return async function resolveInsuranceActorState(insuranceAccountId: string, sessionId: string): Promise<InsuranceActorState> {
    let state = deps.accountStateCache.get(insuranceAccountId);
    if (!state) {
      const account = await deps.insuranceAccountRepo.findById(deps.db, insuranceAccountId);
      if (!account) {
        throw new UnauthenticatedError({ detail: "Sem sessão válida." });
      }
      const insurer = await deps.insurersRepo.findById(deps.db, account.insurerId);
      state = {
        insurerId: account.insurerId,
        role: account.role,
        suspended: account.status === "SUSPENDED" || insurer?.status !== "ACTIVE",
      };
      deps.accountStateCache.set(insuranceAccountId, state);
    }
    return { insuranceAccountId, sessionId, ...state };
  };
}
