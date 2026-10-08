import { describe, expect, it } from "vitest";
import { PasswordWeakError } from "./errors.js";
import { assertPasswordPolicy, hashPassword, verifyPassword } from "./password.js";

describe("assertPasswordPolicy", () => {
  it("aceita uma palavra-passe válida (12+ caracteres, não comum)", () => {
    expect(() => { assertPasswordPolicy("Correcto-Cavalo-7"); }).not.toThrow();
  });

  it.each(["short1", "a".repeat(11), "a".repeat(129)])(
    "rejeita comprimento inválido: %s",
    (password) => {
      expect(() => { assertPasswordPolicy(password); }).toThrow(PasswordWeakError);
    },
  );

  it("rejeita palavras-passe comuns (lista local)", () => {
    expect(() => { assertPasswordPolicy("password123"); }).toThrow(PasswordWeakError);
  });
});

describe("hashPassword / verifyPassword", () => {
  it("hash difere a cada chamada (salt único) mas ambos verificam", async () => {
    const password = "Correcto-Cavalo-7";
    const hashA = await hashPassword(password);
    const hashB = await hashPassword(password);
    expect(hashA).not.toBe(hashB);
    await expect(verifyPassword(hashA, password)).resolves.toBe(true);
    await expect(verifyPassword(hashB, password)).resolves.toBe(true);
  });

  it("rejeita a palavra-passe errada", async () => {
    const hash = await hashPassword("Correcto-Cavalo-7");
    await expect(verifyPassword(hash, "Outra-Palavra-9")).resolves.toBe(false);
  });

  it("nunca lança por um hash malformado", async () => {
    await expect(verifyPassword("não-é-um-hash-argon2", "qualquer-coisa")).resolves.toBe(false);
  });
});
