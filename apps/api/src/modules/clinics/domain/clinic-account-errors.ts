// Erros de domínio do portal da clínica (conventions.md §3.5): reutilizam os códigos genéricos já
// existentes em `platform/errors/codes.ts` (não são específicos de `auth` — o catálogo é partilhado
// por toda a API, errors.md), só a classe/mensagem é própria deste módulo (ADR-020).
import { DomainError, type DomainErrorOptions } from "../../../platform/errors/index.js";

/** 401 — e-mail ou palavra-passe incorretos (mensagem sempre genérica, errors.md). */
export class ClinicInvalidCredentialsError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("AUTH_INVALID_CREDENTIALS", { detail: "Credenciais inválidas.", ...options });
    this.name = "ClinicInvalidCredentialsError";
  }
}

/** 403 — conta do portal suspensa (authorization.md §6.1 passo 1). */
export class ClinicAccountSuspendedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("ACCOUNT_SUSPENDED", { detail: "Conta suspensa.", ...options });
    this.name = "ClinicAccountSuspendedError";
  }
}
