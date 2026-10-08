// Erros de domínio específicos de `auth` (conventions.md §3.5: "erro próprio do módulo que
// estenda DomainError"). Os restantes casos usam diretamente os erros genéricos de `platform`.
import { DomainError, type DomainErrorOptions } from "../../../platform/errors/index.js";

/** 401 — e-mail ou palavra-passe incorretos (mensagem sempre genérica, errors.md). */
export class InvalidCredentialsError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("AUTH_INVALID_CREDENTIALS", {
      detail: "Credenciais inválidas.",
      ...options,
    });
    this.name = "InvalidCredentialsError";
  }
}

/** 403 — conta suspensa pelo Platform Admin (BR-ACC-05). */
export class AccountSuspendedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("ACCOUNT_SUSPENDED", { detail: "Conta suspensa.", ...options });
    this.name = "AccountSuspendedError";
  }
}

/** 403 — login antes de verificar o e-mail (authentication.md §2). */
export class EmailNotVerifiedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("EMAIL_NOT_VERIFIED", { detail: "E-mail por verificar.", ...options });
    this.name = "EmailNotVerifiedError";
  }
}

/** 422 — fora da política (authentication.md §1: mín. 12, máx. 128, não comum). */
export class PasswordWeakError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("PASSWORD_WEAK", { detail: "Palavra-passe fraca.", ...options });
    this.name = "PasswordWeakError";
  }
}
