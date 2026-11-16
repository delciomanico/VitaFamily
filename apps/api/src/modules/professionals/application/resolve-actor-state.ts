// Estado da conta por pedido, com cache ≤60 s (authorization.md §10.1 passo 2): a conta tem de estar `ACTIVE`; o `professionalId` do token
// tem de ser o do perfil da conta (defesa em profundidade). O estado de VALIDAÇÃO não se resolve aqui (lê-se da BD em cada escrita, BR-MKT-29).
import { UnauthenticatedError } from "../../../platform/errors/index.js";
import type { ProfessionalTtlCache } from "../domain/ttl-cache.js";
import type { ProfessionalsDeps } from "./ports.js";

export interface ProfessionalActorState {
  professionalAccountId: string;
  professionalId: string;
  sessionId: string;
}

export function createResolveActorStateUseCase<Trx>(deps: ProfessionalsDeps<Trx>, cache: ProfessionalTtlCache<{ professionalId: string }>) {
  return async function resolveActorState(subject: { professionalAccountId: string; professionalId: string; sessionId: string }): Promise<ProfessionalActorState> {
    let state = cache.get(subject.professionalAccountId);
    if (!state) {
      const account = await deps.accountRepo.findById(deps.db, subject.professionalAccountId);
      if (account?.status !== "ACTIVE") {
        throw new UnauthenticatedError({ detail: "Sem sessão válida." });
      }
      const professional = await deps.accountRepo.findProfessionalByAccountId(deps.db, account.id);
      if (!professional) {
        throw new UnauthenticatedError({ detail: "Sem sessão válida." });
      }
      state = { professionalId: professional.id };
      cache.set(subject.professionalAccountId, state);
    }
    if (state.professionalId !== subject.professionalId) {
      throw new UnauthenticatedError({ detail: "Sem sessão válida." });
    }
    return { professionalAccountId: subject.professionalAccountId, professionalId: state.professionalId, sessionId: subject.sessionId };
  };
}
