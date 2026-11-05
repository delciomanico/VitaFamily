// Hierarquia do portal da seguradora (BR-INS-06, authorization.md §8.2): só o `INSURANCE_ADMIN` da
// própria seguradora cria/lista/remove os seus `INSURANCE_AGENT`; nunca o Platform Admin, nunca
// outra seguradora (NOT_FOUND, sem enumeração, §8.1 passo 2).
import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";
import type { InsuranceAccount, InsuranceAccountRole } from "./insurance-account.js";

export interface InsuranceStaffActor {
  insurerId: string;
  role: InsuranceAccountRole;
}

export function assertCanManageAgents(actor: InsuranceStaffActor): void {
  if (actor.role !== "INSURANCE_ADMIN") {
    throw new ForbiddenError({ detail: "Só o INSURANCE_ADMIN gere agentes da seguradora." });
  }
}

/** Só remove `INSURANCE_AGENT` da própria seguradora; qualquer outro alvo é `NOT_FOUND`. */
export function assertRemovableAgentTarget(actor: InsuranceStaffActor, target: InsuranceAccount | null): InsuranceAccount {
  if (target?.insurerId !== actor.insurerId || target.role !== "INSURANCE_AGENT") {
    throw new NotFoundError({ detail: "Conta não encontrada." });
  }
  return target;
}
