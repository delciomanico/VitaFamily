// Erros de domínio -> application/problem+json (RFC 9457, docs/05-api/errors.md).
// `domain`/`application`/`infrastructure` devolvem SEMPRE um destes erros (ou um erro próprio do
// módulo que estenda DomainError); nunca importam nada de HTTP. `toProblem` é a ÚNICA função que
// os traduz para o corpo da resposta — ver conventions.md §2.
import type { ErrorCode } from "./codes.js";
import { errorCatalog, statusForCode } from "./codes.js";

export type { ErrorCode } from "./codes.js";
export { errorCatalog, statusForCode } from "./codes.js";

/** Erro por campo — só aparece em `VALIDATION_ERROR` (errors.md regra 3). */
export interface FieldError {
  field: string;
  message: string;
}

export interface DomainErrorOptions {
  /** Mensagem curta em pt-PT, sem dados de saúde (errors.md regra 1). */
  detail?: string;
  fields?: FieldError[];
  /** Só para RATE_LIMITED (cabeçalho `Retry-After`). */
  retryAfterMs?: number;
  cause?: unknown;
}

/** Base de todos os erros de domínio traduzíveis para Problem+JSON. */
export class DomainError extends Error {
  readonly code: ErrorCode;
  readonly detail?: string;
  readonly fields?: FieldError[];
  readonly retryAfterMs?: number;

  constructor(code: ErrorCode, options: DomainErrorOptions = {}) {
    super(options.detail ?? errorCatalog[code].title, { cause: options.cause });
    this.name = "DomainError";
    this.code = code;
    if (options.detail !== undefined) {
      this.detail = options.detail;
    }
    if (options.fields !== undefined) {
      this.fields = options.fields;
    }
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
  }
}

/** 404 — recurso inexistente ou de outra família (nunca enumerar; errors.md regra 2). */
export class NotFoundError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("NOT_FOUND", options);
    this.name = "NotFoundError";
  }
}

/** 409 — conflito com o estado atual do recurso. */
export class ConflictError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("CONFLICT", options);
    this.name = "ConflictError";
  }
}

/** 401 — sem sessão válida. */
export class UnauthenticatedError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("UNAUTHENTICATED", options);
    this.name = "UnauthenticatedError";
  }
}

/** 403 — sem permissão (no contexto de um recurso que existe e a que o utilizador pertence). */
export class ForbiddenError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("FORBIDDEN", options);
    this.name = "ForbiddenError";
  }
}

/** 422 — campos inválidos; `fields` é obrigatório (preenche `errors[]` do Problem). */
export class ValidationError extends DomainError {
  constructor(fields: FieldError[], options: Omit<DomainErrorOptions, "fields"> = {}) {
    super("VALIDATION_ERROR", { ...options, fields });
    this.name = "ValidationError";
  }
}

/** 429 — demasiados pedidos; `retryAfterMs` define o cabeçalho `Retry-After`. */
export class RateLimitedError extends DomainError {
  constructor(retryAfterMs: number, options: Omit<DomainErrorOptions, "retryAfterMs"> = {}) {
    super("RATE_LIMITED", { ...options, retryAfterMs });
    this.name = "RateLimitedError";
  }
}

/** 503 — dependência indisponível (ex.: readiness falhou). */
export class ServiceUnavailableError extends DomainError {
  constructor(options: DomainErrorOptions = {}) {
    super("SERVICE_UNAVAILABLE", options);
    this.name = "ServiceUnavailableError";
  }
}

/** Corpo `application/problem+json` (components.schemas.Problem do openapi.yaml). */
export interface Problem {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  requestId: string;
  errors?: FieldError[];
}

/** Prefixo estável do campo `type` (não precisa de resolver; errors.md). */
export const PROBLEM_TYPE_BASE = "https://vitafamily.cassfrei.com/problems/";

export interface ProblemResult {
  status: number;
  body: Problem;
  /** Segundos para o cabeçalho `Retry-After` (só em RATE_LIMITED). */
  retryAfterSeconds?: number;
}

/**
 * Traduz qualquer erro lançado no pedido para Problem+JSON: `DomainError` (e subclasses) passam
 * tal e qual pelo seu `code`; qualquer outro erro é `INTERNAL_ERROR` genérico — o detalhe nunca é
 * exposto ao cliente em 5xx, só vai para os logs com o `requestId` (errors.md regra 4).
 */
export function toProblem(err: unknown, requestId: string): ProblemResult {
  const domainError = err instanceof DomainError ? err : new DomainError("INTERNAL_ERROR");
  const catalogEntry = errorCatalog[domainError.code];
  const status = statusForCode(domainError.code);

  const body: Problem = {
    type: PROBLEM_TYPE_BASE + domainError.code,
    title: catalogEntry.title,
    status,
    code: domainError.code,
    requestId,
  };

  // Em 5xx o detalhe não é exposto (exceção: 503, cujo detalhe é operacional, não de negócio).
  if (status < 500 || status === 503) {
    if (domainError.detail) {
      body.detail = domainError.detail;
    }
  }

  if (domainError.code === "VALIDATION_ERROR" && domainError.fields) {
    body.errors = domainError.fields;
  }

  const result: ProblemResult = { status, body };
  if (domainError.code === "RATE_LIMITED" && domainError.retryAfterMs) {
    result.retryAfterSeconds = Math.max(1, Math.round(domainError.retryAfterMs / 1000));
  }
  return result;
}
