// openapi getInsurancePortalMe: contexto da conta (seguradora, moeda, módulo, papel). Qualquer papel do portal (incl.
// INSURANCE_AGENT; P-SEG-3) e também com o módulo operacional desativado — por isso NÃO passa por `authorize` (§8.1).
// Só dados da própria seguradora (`insurerId` do token); sem dados pessoais da conta nem de beneficiários.
import type { OpsActor, OpsRole } from "../domain/access.js";
import type { OpsDeps } from "./ports.js";
import { notFound } from "./support.js";

export interface PortalMe {
  insurerId: string;
  name: string;
  currency: string;
  operationalModuleEnabled: boolean;
  role: OpsRole;
}

export function createGetPortalMeUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function getPortalMe(actor: OpsActor): Promise<PortalMe> {
    return deps.withTransaction(async (trx) => {
      const settings = await deps.insurers.get(trx, actor.insurerId);
      if (!settings) throw notFound();
      return { insurerId: actor.insurerId, name: settings.name, currency: settings.currency, operationalModuleEnabled: settings.operationalModuleEnabled, role: actor.role };
    });
  };
}
