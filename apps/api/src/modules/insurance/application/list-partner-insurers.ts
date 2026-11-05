// `GET /families/{familyId}/insurers` (FAM_MEMBER, BR-INS-09/ADR-023): só id e nome das seguradoras ACTIVE
// (nunca NIF nem contas). Não é dado de saúde: autoriza-se só a pertença à família.
import { NotFoundError } from "../../../platform/errors/index.js";
import type { ActorIdentity, InsuranceHolderDeps } from "./ports.js";

export interface PartnerInsurerView {
  id: string;
  name: string;
}

export function createListPartnerInsurersUseCase<Trx>(deps: InsuranceHolderDeps<Trx>) {
  return async function listPartnerInsurers(actor: ActorIdentity, familyId: string): Promise<PartnerInsurerView[]> {
    return deps.withTransaction(async (trx) => {
      // Platform Admin não é membro de nenhuma família ⇒ NOT_FOUND (sem enumerar famílias).
      if (!(await deps.membership.getMembershipFacts(trx, familyId, actor.userId))) {
        throw new NotFoundError({ detail: "Família não encontrada." });
      }
      return (await deps.insurersRepo.listActive(trx)).map((insurer) => ({ id: insurer.id, name: insurer.name }));
    });
  };
}
