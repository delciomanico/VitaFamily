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

/** Contas geridas pelo `INSURANCE_ADMIN` da própria seguradora: `INSURANCE_AGENT` e (ADR-025, Fase A) `BENEFICIARY_MANAGER`. */
export const MANAGED_ACCOUNT_ROLES: InsuranceAccountRole[] = ["INSURANCE_AGENT", "BENEFICIARY_MANAGER"];

/** Só remove contas geridas da própria seguradora; qualquer outro alvo (incl. o `INSURANCE_ADMIN`) é `NOT_FOUND`. */
export function assertRemovableAgentTarget(actor: InsuranceStaffActor, target: InsuranceAccount | null): InsuranceAccount {
  if (target?.insurerId !== actor.insurerId || !MANAGED_ACCOUNT_ROLES.includes(target.role)) {
    throw new NotFoundError({ detail: "Conta não encontrada." });
  }
  return target;
}
