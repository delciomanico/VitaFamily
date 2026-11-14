// Entidade pura `InsuranceAccount` (schema.md §3b, ADR-021): conta do portal da seguradora, SEM
// ligação a `users`/`family_members`. Mais os erros de domínio do portal (reutilizam os códigos
// genéricos de `platform/errors`; só a classe/mensagem é própria, mirror de `clinics`).
import { DomainError, type DomainErrorOptions } from "../../../platform/errors/index.js";

/** ADR-025 (authorization.md §8.2b): na Fase A só `INSURANCE_ADMIN`/`BENEFICIARY_MANAGER` têm rotas do módulo operacional. */
export type InsuranceAccountRole =
  | "INSURANCE_ADMIN"
  | "INSURANCE_AGENT"
  | "BENEFICIARY_MANAGER"
  | "AUTHORIZATION_ANALYST"
  | "CLAIMS_MANAGER"
  | "FINANCE_MANAGER";
export type InsuranceAccountStatus = "ACTIVE" | "SUSPENDED";

export interface InsuranceAccount {
  id: string;
  insurerId: string;
  email: string;
  passwordHash: string;
  role: InsuranceAccountRole;
  status: InsuranceAccountStatus;
  /** Preenchido só na conta `INSURANCE_ADMIN` raiz, criada/reposta pelo Platform Admin (BR-INS-06). */
  createdByPlatformAdmin?: string;
  suspendedAt?: Date;
  createdAt: Date;
}

/** 401 — e-mail ou palavra-passe incorretos (mensagem sempre genérica, errors.md). */
export class InsuranceInvalidCredentialsError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("AUTH_INVALID_CREDENTIALS", { detail: "Credenciais inválidas.", ...options });
    this.name = "InsuranceInvalidCredentialsError";
  }
}

/** 403 — conta (ou seguradora, BR-INS-10) suspensa (authorization.md §8.1 passo 1). */
export class InsuranceAccountSuspendedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("ACCOUNT_SUSPENDED", { detail: "Conta suspensa.", ...options });
    this.name = "InsuranceAccountSuspendedError";
  }
}
