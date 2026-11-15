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

/**
 * Contas geridas pelo `INSURANCE_ADMIN` da própria seguradora: `INSURANCE_AGENT`, (ADR-025, Fase A) `BENEFICIARY_MANAGER` e
 * (fatia 4, ADR-035) `AUTHORIZATION_ANALYST` e `SUPERVISOR`. `CLAIMS_MANAGER`/`FINANCE_MANAGER` só quando tiverem rotas (S5).
 */
export const MANAGED_ACCOUNT_ROLES: InsuranceAccountRole[] = ["INSURANCE_AGENT", "BENEFICIARY_MANAGER", "AUTHORIZATION_ANALYST", "SUPERVISOR"];

/** Papéis do módulo operacional: só se criam com `operational_module_enabled` (BR-INS-08, ADR-035). */
export const OPERATIONAL_ROLES: InsuranceAccountRole[] = ["BENEFICIARY_MANAGER", "AUTHORIZATION_ANALYST", "SUPERVISOR"];

/** Só remove contas geridas da própria seguradora; qualquer outro alvo (incl. o `INSURANCE_ADMIN`) é `NOT_FOUND`. */
export function assertRemovableAgentTarget(actor: InsuranceStaffActor, target: InsuranceAccount | null): InsuranceAccount {
  if (target?.insurerId !== actor.insurerId || !MANAGED_ACCOUNT_ROLES.includes(target.role)) {
    throw new NotFoundError({ detail: "Conta não encontrada." });
  }
  return target;
}
