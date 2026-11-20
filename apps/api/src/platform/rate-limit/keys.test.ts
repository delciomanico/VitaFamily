import { describe, expect, it } from "vitest";
import { assertNamespace, buildRateLimitKey, hashSubject } from "./keys.js";

const SECRET = "segredo-de-teste-com-32-caracteres!!";
const OPTIONS = { prefix: "vita:test", namespace: "auth", secret: SECRET };

describe("buildRateLimitKey", () => {
  it("usa o formato {prefixo}:rl:v1:{namespace}:{regra}:{sujeito}", () => {
    const key = buildRateLimitKey(OPTIONS, { rule: "login.ip", subject: "203.0.113.7" });
    expect(key).toBe("vita:test:rl:v1:auth:login.ip:203.0.113.7");
  });

  it("com pii: true, o sujeito é um HMAC de 32 hex e não contém o valor original", () => {
    const email = "ana.silva@example.com";
    const ip = "203.0.113.7";

    const emailKey = buildRateLimitKey(OPTIONS, { rule: "login.account", subject: email, pii: true });
    const ipKey = buildRateLimitKey(OPTIONS, { rule: "login.ip", subject: ip, pii: true });

    const emailSubject = emailKey.split(":").at(-1) ?? "";
    const ipSubject = ipKey.split(":").at(-1) ?? "";
    expect(emailSubject).toMatch(/^[0-9a-f]{32}$/);
    expect(ipSubject).toMatch(/^[0-9a-f]{32}$/);

    expect(emailKey).not.toContain(email);
    expect(emailKey).not.toContain("ana.silva");
    expect(ipKey).not.toContain(ip);
  });

  it("com pii: true, mesmo valor e mesmo segredo dão a mesma chave", () => {
    const first = buildRateLimitKey(OPTIONS, { rule: "login.account", subject: "ana@example.com", pii: true });
    const second = buildRateLimitKey(OPTIONS, { rule: "login.account", subject: "ana@example.com", pii: true });
    expect(second).toBe(first);
  });

  it("com pii: true, segredo diferente dá chave diferente", () => {
    const other = { ...OPTIONS, secret: "outro-segredo-diferente-com-32-chars!!" };
    const first = buildRateLimitKey(OPTIONS, { rule: "login.account", subject: "ana@example.com", pii: true });
    const second = buildRateLimitKey(other, { rule: "login.account", subject: "ana@example.com", pii: true });
    expect(second).not.toBe(first);
  });

  it("sem pii, o sujeito fica em claro", () => {
    const key = buildRateLimitKey(OPTIONS, { rule: "login.account", subject: "ana@example.com" });
    expect(key).toBe("vita:test:rl:v1:auth:login.account:ana@example.com");
  });

  it("com pii: false, o sujeito fica em claro", () => {
    const key = buildRateLimitKey(OPTIONS, { rule: "login.ip", subject: "203.0.113.7", pii: false });
    expect(key).toBe("vita:test:rl:v1:auth:login.ip:203.0.113.7");
  });

  it.each(["Login", "login ip", "login/ip", "", " login"])("rejeita a regra inválida %j", (rule) => {
    expect(() => buildRateLimitKey(OPTIONS, { rule, subject: "x" })).toThrowError(/Regra de rate limiting inválida/);
  });

  it("namespaces diferentes dão chaves diferentes para a mesma regra e sujeito", () => {
    const key = { rule: "login.ip", subject: "203.0.113.7" };
    const auth = buildRateLimitKey({ ...OPTIONS, namespace: "auth" }, key);
    const family = buildRateLimitKey({ ...OPTIONS, namespace: "family" }, key);
    expect(auth).not.toBe(family);
    expect(auth).toBe("vita:test:rl:v1:auth:login.ip:203.0.113.7");
    expect(family).toBe("vita:test:rl:v1:family:login.ip:203.0.113.7");
  });
});

describe("hashSubject", () => {
  it("devolve 32 caracteres hexadecimais", () => {
    expect(hashSubject(SECRET, "valor")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("é determinístico para o mesmo segredo e valor", () => {
    expect(hashSubject(SECRET, "valor")).toBe(hashSubject(SECRET, "valor"));
  });

  it("muda com o valor e com o segredo", () => {
    expect(hashSubject(SECRET, "valor-a")).not.toBe(hashSubject(SECRET, "valor-b"));
    expect(hashSubject(SECRET, "valor")).not.toBe(hashSubject("outro-segredo-diferente-com-32-chars!!", "valor"));
  });
});

describe("assertNamespace", () => {
  it.each(["auth", "family", "clinic-portal", "a1"])("aceita o namespace válido %s", (namespace) => {
    expect(() => {
      assertNamespace(namespace);
    }).not.toThrow();
  });

  it.each(["", "Auth", "auth ", "auth.login", "-auth", "auth/x", "auth_x"])(
    "rejeita o namespace inválido %j",
    (namespace) => {
      expect(() => {
        assertNamespace(namespace);
      }).toThrowError(/Namespace de rate limiting inválido/);
    },
  );
});
