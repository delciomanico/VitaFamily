// Middleware de erro central: a ÚNICA função que escreve application/problem+json
// (conventions.md §2: "nunca responder sem passar por toProblem"). Também traduz as falhas do
// validador OpenAPI (express-openapi-validator) e do parser de JSON para erros de domínio.
import type { ErrorRequestHandler, RequestHandler } from "express";
import type { Logger } from "../logger/index.js";
import {
  DomainError,
  NotFoundError,
  UnauthenticatedError,
  ValidationError,
  toProblem,
} from "../errors/index.js";

interface OpenApiValidatorIssue {
  path: string;
  message: string;
}

/** Forma comum aos erros lançados pelo express-openapi-validator (ver dist/framework/types.js). */
interface OpenApiValidatorError {
  status: number;
  errors: OpenApiValidatorIssue[];
}

function isOpenApiValidatorError(err: unknown): err is OpenApiValidatorError {
  if (typeof err !== "object" || err === null) {
    return false;
  }
  if (!("status" in err) || typeof err.status !== "number") {
    return false;
  }
  if (!("errors" in err) || !Array.isArray(err.errors)) {
    return false;
  }
  return true;
}

function isBodyParserSyntaxError(err: unknown): boolean {
  if (err instanceof SyntaxError) {
    return true;
  }
  if (typeof err !== "object" || err === null || !("type" in err)) {
    return false;
  }
  return typeof err.type === "string" && err.type.startsWith("entity.");
}

function lastPathSegment(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * Traduz uma falha do validador OpenAPI (contrato) para um erro de domínio. Body inválido contra
 * o schema -> `VALIDATION_ERROR` com `fields[]`; parâmetros/cabeçalhos/rota -> `MALFORMED_REQUEST`;
 * segurança -> `UNAUTHENTICATED`; rota inexistente -> `NOT_FOUND`.
 */
function mapOpenApiValidatorError(err: OpenApiValidatorError): DomainError {
  if (err.status === 404) {
    return new NotFoundError();
  }
  if (err.status === 405) {
    return new DomainError("MALFORMED_REQUEST", { detail: "Método não permitido." });
  }
  if (err.status === 401) {
    return new UnauthenticatedError({ detail: "Sem sessão válida." });
  }
  if (err.status === 400) {
    const bodyIssues = err.errors.filter((issue) => issue.path.startsWith("/body"));
    if (bodyIssues.length > 0) {
      const fields = bodyIssues.map((issue) => ({
        field: lastPathSegment(issue.path),
        message: "valor inválido",
      }));
      return new ValidationError(fields, { detail: "Dados inválidos." });
    }
    return new DomainError("MALFORMED_REQUEST", { detail: "Parâmetro inválido." });
  }
  return new DomainError("MALFORMED_REQUEST", { detail: "Pedido malformado." });
}

function toDomainError(err: unknown): DomainError {
  if (err instanceof DomainError) {
    return err;
  }
  if (isBodyParserSyntaxError(err)) {
    return new DomainError("MALFORMED_REQUEST", { detail: "Pedido malformado." });
  }
  if (isOpenApiValidatorError(err)) {
    return mapOpenApiValidatorError(err);
  }
  return new DomainError("INTERNAL_ERROR", { cause: err });
}

/** Cria o middleware de erro central (último middleware da app). */
export function createErrorMiddleware(logger: Logger): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const requestId = req.requestId;
    const domainError = toDomainError(err);
    const { status, body, retryAfterSeconds } = toProblem(domainError, requestId);

    if (status >= 500) {
      logger.error({ requestId, err: domainError.cause ?? err }, "unhandled_error");
    }

    if (retryAfterSeconds) {
      res.setHeader("Retry-After", String(retryAfterSeconds));
    }
    res.status(status).type("application/problem+json").json(body);
  };
}

/** 404 Problem para qualquer pedido que não bateu em nenhuma rota (fora do contrato OpenAPI). */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError());
};
