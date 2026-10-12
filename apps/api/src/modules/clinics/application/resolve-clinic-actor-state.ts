// Estado da conta do portal, por pedido, com cache ≤60 s (mesmo critério de
// `auth/application/resolve-actor-state.ts`; authorization.md §6.1 passo 1: "ClinicAccount.status
// ≠ ACTIVE ⇒ DENY" tem de refletir suspensões em tempo real, não só o que estava no JWT no login).
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { ClinicTtlCache } from "../domain/clinic-ttl-cache.js";
import type { ClinicAccountRole, ClinicsDeps } from "./ports.js";

export interface ClinicActorState {
  clinicAccountId: string;
  sessionId: string;
  clinicId: string;
  role: ClinicAccountRole;
  suspended: boolean;
}

interface CachedClinicAccountState {
  clinicId: string;
  role: ClinicAccountRole;
  suspended: boolean;
}

export function createResolveClinicActorStateUseCase<Trx>(
  deps: ClinicsDeps<Trx>,
  cache: ClinicTtlCache<CachedClinicAccountState>,
) {
  return async function resolveClinicActorState(clinicAccountId: string, sessionId: string): Promise<ClinicActorState> {
    let accountState = cache.get(clinicAccountId);
    if (!accountState) {
      const account = await deps.clinicAccountRepo.findById(deps.db, clinicAccountId);
      if (!account) {
        throw new UnauthenticatedError({ detail: "Sem sessão válida." });
      }
      accountState = {
        clinicId: account.clinicId,
        role: account.role,
        suspended: account.status === "SUSPENDED",
      };
      cache.set(clinicAccountId, accountState);
    }

    return { clinicAccountId, sessionId, ...accountState };
  };
}
