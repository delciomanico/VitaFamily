// Testes unitários da política e do hashing de palavras-passe do profissional (authentication.md §1/§5). Sem I/O.
import { beforeAll, describe, expect, it } from "vitest";
import { DomainError } from "../../../platform/errors/index.js";
import { assertPasswordPolicy, hashPassword, verifyAgainstDummy, verifyPassword } from "./password.js";

/** Apanha o erro lançado por `fn` (falha o teste se não lançar). */
function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("esperava-se um erro");
}

describe("assertPasswordPolicy", () => {
  it("rejeita palavras-passe com menos de 12 caracteres", () => {
    const error = captureError(() => {
      assertPasswordPolicy("a".repeat(11));
    });
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "PASSWORD_WEAK" });
  });

  it("aceita palavras-passe com exatamente 12 caracteres", () => {
    expect(() => {
      assertPasswordPolicy("a".repeat(12));
    }).not.toThrow();
  });

  it("aceita palavras-passe com exatamente 128 caracteres", () => {
    expect(() => {
      assertPasswordPolicy("Xk9#".repeat(32));
    }).not.toThrow();
  });

  it("rejeita palavras-passe com mais de 128 caracteres", () => {
    const error = captureError(() => {
      assertPasswordPolicy("a".repeat(129));
    });
    expect(error).toMatchObject({ code: "PASSWORD_WEAK" });
  });

  it.each(["password1234", "PASSWORD1234", "Password1234"])("rejeita a palavra-passe comum %s (sem distinguir maiúsculas)", (password) => {
    const error = captureError(() => {
      assertPasswordPolicy(password);
    });
    expect(error).toMatchObject({ code: "PASSWORD_WEAK" });
  });

  it("aceita uma palavra-passe forte e fora da lista de comuns", () => {
    expect(() => {
      assertPasswordPolicy("correto-cavalo-bateria-42");
    }).not.toThrow();
  });
});

describe("hashPassword e verifyPassword", () => {
  const password = "correto-cavalo-bateria-42";
  let hash: string;

  beforeAll(async () => {
    hash = await hashPassword(password);
  });

  it("gera um hash argon2id", () => {
    expect(hash.startsWith("$argon2id$")).toBe(true);
  });

  it("verifica como verdadeira a palavra-passe correta", async () => {
    await expect(verifyPassword(hash, password)).resolves.toBe(true);
  });

  it("verifica como falsa uma palavra-passe incorreta", async () => {
    await expect(verifyPassword(hash, "outra-palavra-passe-99")).resolves.toBe(false);
  });

  it("devolve falso (sem lançar) para um hash malformado", async () => {
    await expect(verifyPassword("isto-nao-e-um-hash", password)).resolves.toBe(false);
  });
});

describe("verifyAgainstDummy", () => {
  it("não lança, mesmo para uma palavra-passe qualquer", async () => {
    await expect(verifyAgainstDummy("qualquer-coisa-aqui-12")).resolves.toBeUndefined();
  });
});
