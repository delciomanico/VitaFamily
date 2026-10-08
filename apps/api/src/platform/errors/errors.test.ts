import { describe, expect, it } from "vitest";
import {
  ConflictError,
  DomainError,
  ForbiddenError,
  NotFoundError,
  RateLimitedError,
  UnauthenticatedError,
  ValidationError,
  toProblem,
} from "./index.js";

describe("toProblem", () => {
  it("traduz NotFoundError para 404 NOT_FOUND", () => {
    const { status, body } = toProblem(new NotFoundError(), "req-1");
    expect(status).toBe(404);
    expect(body).toMatchObject({ code: "NOT_FOUND", status: 404, requestId: "req-1" });
    expect(body.type).toBe("https://vitafamily.cassfrei.com/problems/NOT_FOUND");
  });

  it.each([
    [new ConflictError(), 409, "CONFLICT"],
    [new ForbiddenError(), 403, "FORBIDDEN"],
    [new UnauthenticatedError(), 401, "UNAUTHENTICATED"],
  ] as const)("traduz %#  para o código esperado", (error, status, code) => {
    const result = toProblem(error, "req-x");
    expect(result.status).toBe(status);
    expect(result.body.code).toBe(code);
  });

  it("inclui detail em erros 4xx", () => {
    const { body } = toProblem(new NotFoundError({ detail: "Recurso não encontrado." }), "req-2");
    expect(body.detail).toBe("Recurso não encontrado.");
  });

  it("nunca expõe detail em erros 5xx genéricos (INTERNAL_ERROR)", () => {
    const err = new DomainError("INTERNAL_ERROR", { detail: "stack trace sensível" });
    const { body, status } = toProblem(err, "req-3");
    expect(status).toBe(500);
    expect(body.detail).toBeUndefined();
  });

  it("qualquer erro desconhecido (não DomainError) vira INTERNAL_ERROR genérico sem fuga de detalhe", () => {
    const { status, body } = toProblem(new Error("boom, segredo interno"), "req-4");
    expect(status).toBe(500);
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.detail).toBeUndefined();
  });

  it("preenche errors[] só em VALIDATION_ERROR", () => {
    const err = new ValidationError([{ field: "email", message: "inválido" }]);
    const { body } = toProblem(err, "req-5");
    expect(body.errors).toEqual([{ field: "email", message: "inválido" }]);
  });

  it("não preenche errors[] em códigos que não são VALIDATION_ERROR", () => {
    const { body } = toProblem(new ConflictError(), "req-6");
    expect(body.errors).toBeUndefined();
  });

  it("calcula Retry-After (segundos, arredondado, mínimo 1) em RATE_LIMITED", () => {
    const { retryAfterSeconds } = toProblem(new RateLimitedError(250), "req-7");
    expect(retryAfterSeconds).toBe(1);
  });

  it("não define Retry-After fora de RATE_LIMITED", () => {
    const { retryAfterSeconds } = toProblem(new ConflictError(), "req-8");
    expect(retryAfterSeconds).toBeUndefined();
  });
});
