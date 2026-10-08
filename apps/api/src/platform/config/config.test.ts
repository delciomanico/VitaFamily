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

describe("loadConfig", () => {
  it("carrega com sucesso quando todas as obrigatórias estão presentes", () => {
    const config = loadConfig(validEnv());
    expect(config.DATABASE_URL).toBe("postgres://vita:vita@localhost:5432/vita");
    expect(config.TERMS_VERSION).toBe("1.0.0");
  });

  it("aplica defeitos documentados quando a variável é opcional", () => {
    const config = loadConfig(validEnv());
    expect(config.NODE_ENV).toBe("local");
    expect(config.PORT).toBe(8080);
    expect(config.LOG_LEVEL).toBe("info");
    expect(config.S3_REGION).toBe("eu-west-1");
    expect(config.UPLOAD_MAX_BYTES).toBe(10_485_760);
    expect(config.FAMILY_STORAGE_QUOTA_BYTES).toBe(104_857_600);
    expect(config.METRICS_ENABLED).toBe(false);
  });

  it.each([
    "TERMS_VERSION",
    "DATABASE_URL",
    "S3_ENDPOINT",
    "S3_ACCESS_KEY",
    "S3_SECRET_KEY",
    "CLAMAV_HOST",
    "JWT_SIGNING_KEYS",
    "SMTP_URL",
    "MAIL_FROM",
    "VAPID_PUBLIC_KEY",
    "VAPID_PRIVATE_KEY",
    "VAPID_SUBJECT",
  ])("falha rápido quando %s está em falta", (key) => {
    const env = validEnv({ [key]: undefined });
    expect(() => loadConfig(env)).toThrowError(new RegExp(key));
  });

  it("rejeita NODE_ENV fora do conjunto permitido", () => {
    expect(() => loadConfig(validEnv({ NODE_ENV: "dev" }))).toThrow();
  });

  it("converte PORT para número", () => {
    const config = loadConfig(validEnv({ PORT: "3000" }));
    expect(config.PORT).toBe(3000);
  });
});
