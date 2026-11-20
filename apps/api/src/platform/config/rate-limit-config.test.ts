import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

/** Conjunto mínimo de variáveis obrigatórias (environment.md §2) para um ambiente válido. */
function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    TERMS_VERSION: "1.0.0",
    DATABASE_URL: "postgres://vita:vita@localhost:5432/vita",
    S3_ENDPOINT: "http://localhost:9000",
    S3_ACCESS_KEY: "key",
    S3_SECRET_KEY: "secret",
    CLAMAV_HOST: "localhost",
    JWT_SIGNING_KEYS: '[{"kid":"k1","key":"..."}]',
    SMTP_URL: "smtp://localhost:1025",
    MAIL_FROM: "no-reply@vitafamily.cassfrei.com",
    VAPID_PUBLIC_KEY: "pub",
    VAPID_PRIVATE_KEY: "priv",
    VAPID_SUBJECT: "mailto:ops@vitafamily.cassfrei.com",
    ...overrides,
  };
}

/** Ambiente de produção completo e válido para os limitadores de taxa (ADR-038). */
function productionEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return validEnv({
    NODE_ENV: "production",
    CLINIC_LINK_CODE_SECRET: "clinic-secret-16+chars",
    REDIS_URL: "redis://redis:6379",
    RATE_LIMIT_KEY_SECRET: "x".repeat(32),
    ...overrides,
  });
}

describe("loadConfig: limitadores de taxa (ADR-038)", () => {
  describe("defaults fora de produção sem REDIS_URL", () => {
    it("aplica os defaults de Redis e de backend", () => {
      const config = loadConfig(validEnv());
      expect(config.REDIS_URL).toBeUndefined();
      expect(config.REDIS_COMMAND_TIMEOUT_MS).toBe(200);
      expect(config.REDIS_CONNECT_TIMEOUT_MS).toBe(1000);
      expect(config.RATE_LIMIT_BACKEND).toBe("redis");
    });

    it("define o prefixo de chaves como vita:{NODE_ENV}", () => {
      expect(loadConfig(validEnv()).RATE_LIMIT_KEY_PREFIX).toBe("vita:local");
      expect(loadConfig(validEnv({ NODE_ENV: "test" })).RATE_LIMIT_KEY_PREFIX).toBe("vita:test");
    });

    it("usa o segredo de desenvolvimento quando RATE_LIMIT_KEY_SECRET não é definido", () => {
      const config = loadConfig(validEnv());
      expect(config.RATE_LIMIT_KEY_SECRET.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe("production", () => {
    it("lança sem REDIS_URL", () => {
      expect(() => loadConfig(productionEnv({ REDIS_URL: undefined }))).toThrowError(/REDIS_URL/);
    });

    it("lança sem RATE_LIMIT_KEY_SECRET", () => {
      expect(() => loadConfig(productionEnv({ RATE_LIMIT_KEY_SECRET: undefined }))).toThrowError(/RATE_LIMIT_KEY_SECRET/);
    });

    it("lança com RATE_LIMIT_BACKEND=memory", () => {
      expect(() => loadConfig(productionEnv({ RATE_LIMIT_BACKEND: "memory" }))).toThrowError(/RATE_LIMIT_BACKEND/);
    });

    it("aceita a configuração completa e devolve a config", () => {
      const config = loadConfig(productionEnv());
      expect(config.NODE_ENV).toBe("production");
      expect(config.REDIS_URL).toBe("redis://redis:6379");
      expect(config.RATE_LIMIT_KEY_SECRET).toBe("x".repeat(32));
      expect(config.RATE_LIMIT_BACKEND).toBe("redis");
      expect(config.RATE_LIMIT_KEY_PREFIX).toBe("vita:production");
    });
  });

  describe("validação de RATE_LIMIT_KEY_SECRET", () => {
    it("lança com menos de 32 caracteres", () => {
      expect(() => loadConfig(validEnv({ RATE_LIMIT_KEY_SECRET: "x".repeat(31) }))).toThrowError(/RATE_LIMIT_KEY_SECRET/);
    });
  });

  describe("local", () => {
    it("aceita RATE_LIMIT_BACKEND=memory", () => {
      const config = loadConfig(validEnv({ RATE_LIMIT_BACKEND: "memory" }));
      expect(config.RATE_LIMIT_BACKEND).toBe("memory");
    });
  });
});
