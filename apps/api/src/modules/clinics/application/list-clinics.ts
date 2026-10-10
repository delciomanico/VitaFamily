// openapi.yaml `listClinics`: "Autorização: FAM_MEMBER. R8." Parceiras (globais) + privadas da família.
import type { Clinic, ClinicStatus } from "../domain/clinic.js";
import type { ActorIdentity, ClinicsDeps } from "./ports.js";
import { requireMembership } from "./support.js";

export interface ListClinicsQuery {
  status?: string;
}

function parseStatus(status?: string): ClinicStatus | undefined {
  return status === "ACTIVE" || status === "ARCHIVED" ? status : undefined;
}

export function createListClinicsUseCase<Trx>(deps: ClinicsDeps<Trx>) {
  return async function listClinics(actor: ActorIdentity, familyId: string, query: ListClinicsQuery): Promise<Clinic[]> {
    const status = parseStatus(query.status);
    return deps.withTransaction(async (trx) => {
      await requireMembership(deps, trx, familyId, actor.userId);
      return deps.clinicsRepo.listVisibleToFamily(trx, familyId, { ...(status ? { status } : {}) });
    });
  };
}
