// Papéis do módulo operacional (authorization.md §8.2b, Fase A). Regra pura, sem I/O: as rotas de `insurer-ops` NÃO usam
// `AccessPolicy` (ator `InsuranceAccount`, §8.1). `INSURANCE_AGENT` só tem o fluxo de reembolso (ADR-021).
import { ForbiddenError, NotFoundError } from "../../../platform/errors/index.js";

export type OpsRole = "INSURANCE_ADMIN" | "INSURANCE_AGENT" | "BENEFICIARY_MANAGER" | "AUTHORIZATION_ANALYST" | "CLAIMS_MANAGER" | "FINANCE_MANAGER";

/** Ator do portal da seguradora (`insurerId`/`role` vêm sempre do token, nunca do corpo/query/caminho). */
export interface OpsActor {
  insuranceAccountId: string;
  insurerId: string;
  role: OpsRole;
}

/**
 * `read`: qualquer papel do módulo; `write`: ADMIN e BENEFICIARY_MANAGER (empresas, beneficiários, apólices, importações,
 * ligações); `admin`: só INSURANCE_ADMIN (planos, coberturas, serviços, prestadores, clínicas parceiras — §8.2b).
 */
export type OpsAccess = "read" | "write" | "admin";

/** Escrita de empresas, beneficiários, apólices, importações e ligações (§8.2b: ✓ ADMIN e BENEFICIARY_MANAGER). */
const WRITE_ROLES: OpsRole[] = ["INSURANCE_ADMIN", "BENEFICIARY_MANAGER"];
/** Leitura: qualquer papel do módulo (os três restantes ficam definidos, sem rotas de escrita na Fase A). */
const READ_ROLES: OpsRole[] = [...WRITE_ROLES, "AUTHORIZATION_ANALYST", "CLAIMS_MANAGER", "FINANCE_MANAGER"];

/** Módulo desativado ⇒ inexistente para o ator (`NOT_FOUND`), antes de qualquer decisão por papel (§8.2b nota e). */
export function assertModuleEnabled(enabled: boolean): void {
  if (!enabled) {
    throw new NotFoundError({ detail: "Recurso não encontrado." });
  }
}

const ADMIN_ROLES: OpsRole[] = ["INSURANCE_ADMIN"];

export function assertOpsRole(role: OpsRole, access: OpsAccess): void {
  const allowed = access === "admin" ? ADMIN_ROLES : access === "write" ? WRITE_ROLES : READ_ROLES;
  if (!allowed.includes(role)) {
    throw new ForbiddenError({ detail: "Sem permissão para esta operação." });
  }
}

/** Ator do portal da clínica nas rotas `/clinic-portal/insurers/*` (§8.4): vem sempre do token (`ClinicActorInfo`). */
export type ClinicOpsRole = "CLINIC_ADMIN" | "CLINIC_MANAGER" | "CLINIC_DOCTOR";

export interface ClinicOpsActor {
  clinicAccountId: string;
  clinicId: string;
  role: ClinicOpsRole;
}

/** §8.4 (Q6): Admin e Gestor; o Médico (M14 R) ⇒ `FORBIDDEN` por decisão do proprietário (2026-11-11). */
export function assertClinicRole(role: ClinicOpsRole): void {
  if (role !== "CLINIC_ADMIN" && role !== "CLINIC_MANAGER") {
    throw new ForbiddenError({ detail: "Sem permissão para esta operação." });
  }
}
