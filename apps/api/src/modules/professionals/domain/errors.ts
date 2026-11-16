// Erros de domínio do módulo `professionals` (conventions.md §3.5). Códigos de errors.md; sem dados pessoais no `detail`.
import { DomainError, type DomainErrorOptions } from "../../../platform/errors/index.js";

/** 409 — escrita não permitida no estado de validação atual (BR-MKT-23, authorization.md §10.2). `detail` genérico: o motivo do admin vai em `statusReason`. */
export class ProfessionalLockedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("PROFESSIONAL_LOCKED", { detail: "Não é possível alterar neste estado de validação.", ...options });
    this.name = "ProfessionalLockedError";
  }
}

/** 409 — transição de estado não permitida (BR-MKT-15). */
export class InvalidStateTransitionError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("INVALID_STATE_TRANSITION", { detail: "Transição de estado não permitida.", ...options });
    this.name = "InvalidStateTransitionError";
  }
}

/** 401 — e-mail ou palavra-passe incorretos (mensagem sempre genérica, errors.md). */
export class ProfessionalInvalidCredentialsError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("AUTH_INVALID_CREDENTIALS", { detail: "Credenciais inválidas.", ...options });
    this.name = "ProfessionalInvalidCredentialsError";
  }
}

/** 403 — login com palavra-passe certa mas e-mail por verificar (BR-MKT-14). */
export class ProfessionalEmailNotVerifiedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("EMAIL_NOT_VERIFIED", { detail: "E-mail por verificar.", ...options });
    this.name = "ProfessionalEmailNotVerifiedError";
  }
}
