// Configuração por variáveis de ambiente — lista e grupos: docs/10-operations/environment.md §2.
// Validada no arranque (falha rápida se faltar/for inválida uma variável obrigatória); os valores
// nunca são registados em logs (ver platform/logger, campos sensíveis redigidos).
import { z } from "zod";

// `z.coerce.boolean()` faz `Boolean(valor)`: qualquer string não vazia (incluindo a string
// "false") dá `true`. Variáveis de ambiente são sempre strings, por isso comparamos o texto.
const booleanEnv = (defaultValue: boolean) =>
  z
    .string()
    .default(String(defaultValue))
    .transform((value) => value === "true");

/**
 * `TRUST_PROXY`: nº de saltos de proxy confiáveis (inteiro >= 0) ou lista de IP/CIDR separada por
 * vírgulas (formato do `trust proxy` do Express). Default "1" (comportamento histórico).
 */
const IP_OR_CIDR = /^[0-9a-fA-F:.]+(\/\d{1,3})?$/;
const trustProxyEnv = z
  .string()
  .default("1")
  .transform((raw, ctx): number | string[] => {
    const value = raw.trim();
    if (/^\d+$/.test(value)) return Number(value);
    const parts = value.split(",").map((part) => part.trim());
    if (value === "" || !parts.every((part) => IP_OR_CIDR.test(part))) {
      ctx.addIssue({ code: "custom", message: "TRUST_PROXY deve ser um inteiro de saltos ou lista de IP/CIDR separada por vírgulas" });
      return z.NEVER;
    }
    return parts;
  });

const envSchema = z.object({
  // Aplicação
  NODE_ENV: z.enum(["local", "test", "staging", "production"]).default("local"),
  PORT: z.coerce.number().int().positive().default(8080),
  APP_BASE_URL: z.string().url().default("http://localhost:8080"),
  PWA_ORIGIN: z.string().default(""),
  TRUST_PROXY: trustProxyEnv,
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TERMS_VERSION: z.string().min(1, "TERMS_VERSION é obrigatória (B6)"),

  // Base de dados
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  DATABASE_MAINTENANCE_URL: z.string().optional(),

  // Armazenamento (MinIO/S3) — `S3_USE_SSL` já existia em `deploy/.env.example` mas faltava aqui
  // (M5/`platform/storage`: `MinioStorage` precisa de o saber para montar o cliente do SDK).
  S3_ENDPOINT: z.string().min(1, "S3_ENDPOINT é obrigatória"),
  S3_USE_SSL: booleanEnv(false),
  S3_REGION: z.string().default("eu-west-1"),
  S3_BUCKET_DOCUMENTS: z.string().default("vita-documents"),
  S3_BUCKET_EXPORTS: z.string().default("vita-exports"),
  S3_ACCESS_KEY: z.string().min(1, "S3_ACCESS_KEY é obrigatória"),
  S3_SECRET_KEY: z.string().min(1, "S3_SECRET_KEY é obrigatória"),

  // Antivírus (ClamAV)
  CLAMAV_HOST: z.string().min(1, "CLAMAV_HOST é obrigatória"),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),

  // Autenticação (o formato de JWT_SIGNING_KEYS é validado pelo módulo `auth`, M1)
  JWT_SIGNING_KEYS: z.string().min(1, "JWT_SIGNING_KEYS é obrigatória"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  REFRESH_TTL: z.string().default("30d"),
  COOKIE_DOMAIN: z.string().default(""),

  // Portal da clínica (M14 P, BR-CLN-20): segredo do HMAC dos códigos de ligação. Obrigatório em staging/production
  // (ver `loadConfig`); em local/test usa-se um valor fixo de desenvolvimento.
  CLINIC_LINK_CODE_SECRET: z.string().min(16, "CLINIC_LINK_CODE_SECRET deve ter pelo menos 16 caracteres").optional(),

  // Limitadores de taxa em Redis (ADR-038). Em staging/production: REDIS_URL e RATE_LIMIT_KEY_SECRET obrigatórios e
  // `memory` recusado (ver `loadConfig`); fora de production sem REDIS_URL o limitador usa memória (aviso no arranque).
  REDIS_URL: z.string().min(1).optional(),
  REDIS_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(200),
  REDIS_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_KEY_PREFIX: z.string().min(1).optional(),
  RATE_LIMIT_KEY_SECRET: z.string().min(32, "RATE_LIMIT_KEY_SECRET deve ter pelo menos 32 bytes").optional(),
  RATE_LIMIT_BACKEND: z.enum(["redis", "memory"]).default("redis"),

  // E-mail
  SMTP_URL: z.string().min(1, "SMTP_URL é obrigatória"),
  MAIL_FROM: z.string().min(1, "MAIL_FROM é obrigatória"),

  // Web Push
  VAPID_PUBLIC_KEY: z.string().min(1, "VAPID_PUBLIC_KEY é obrigatória"),
  VAPID_PRIVATE_KEY: z.string().min(1, "VAPID_PRIVATE_KEY é obrigatória"),
  VAPID_SUBJECT: z.string().min(1, "VAPID_SUBJECT é obrigatória"),

  // Limites
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(10_485_760),
  FAMILY_STORAGE_QUOTA_BYTES: z.coerce.number().int().positive().default(104_857_600),

  // Observabilidade
  METRICS_ENABLED: booleanEnv(false),

  // MK4 (BR-MKT-79): receita digital do profissional. Desligada por omissão até ao parecer jurídico (OP-61/OP-125); lida no arranque
  // (ligá-la ou desligá-la exige reiniciar a API). Nunca ligar sem o parecer.
  DIGITAL_PRESCRIPTION_ENABLED: booleanEnv(false),

  // M18 (ADR-039, BR-AI-14): assistente de IA ligado pelo utilizador. Desligado por omissão até à AIPD e ao parecer jurídico; lido no
  // arranque (as rotas `ai` respondem 404 com a flag desligada). `AI_SESSION_SECRET` assina o `sessionToken` (HMAC, 15 min).
  AI_ASSISTANT_ENABLED: booleanEnv(false),
  AI_SESSION_SECRET: z.string().min(32, "AI_SESSION_SECRET deve ter pelo menos 32 caracteres").optional(),
  SENTRY_DSN: z.string().optional(),
});

/** Valor só para `local`/`test` (nunca produção: `loadConfig` exige o segredo real em staging/production). */
const DEV_CLINIC_LINK_CODE_SECRET = "dev-only-clinic-link-code-secret-change-me";
/** Valor só para `local`/`test` (production exige `RATE_LIMIT_KEY_SECRET`, ADR-038 §8). */
/** Valor só para `local`/`test` (production com `AI_ASSISTANT_ENABLED=true` exige `AI_SESSION_SECRET`). */
const DEV_AI_SESSION_SECRET = "dev-only-ai-session-secret-change-me-0123456789abcdef";
const DEV_RATE_LIMIT_KEY_SECRET = "dev-only-rate-limit-key-secret-change-me-0123456789";

export type Config = Readonly<
  Omit<z.infer<typeof envSchema>, "CLINIC_LINK_CODE_SECRET" | "RATE_LIMIT_KEY_SECRET" | "RATE_LIMIT_KEY_PREFIX" | "AI_SESSION_SECRET"> & {
    CLINIC_LINK_CODE_SECRET: string;
    AI_SESSION_SECRET: string;
    RATE_LIMIT_KEY_SECRET: string;
    RATE_LIMIT_KEY_PREFIX: string;
  }
>;

/** Nomes de variáveis cujo valor nunca deve ser registado em logs/erros (ver platform/logger). */
export const SENSITIVE_ENV_VARS = [
  "DATABASE_URL",
  "DATABASE_MAINTENANCE_URL",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "JWT_SIGNING_KEYS",
  "CLINIC_LINK_CODE_SECRET",
  "REDIS_URL",
  "RATE_LIMIT_KEY_SECRET",
  "AI_SESSION_SECRET",
  "SMTP_URL",
  "VAPID_PRIVATE_KEY",
  "SENTRY_DSN",
] as const;

/**
 * Carrega e valida a configuração a partir de `env` (por defeito `process.env`).
 * Lança `Error` com todas as variáveis em falta/inválidas juntas (falha rápida e explícita).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Configuração inválida: ${issues}`);
  }
  const secret = result.data.CLINIC_LINK_CODE_SECRET;
  if (secret === undefined && (result.data.NODE_ENV === "production" || result.data.NODE_ENV === "staging")) {
    throw new Error("Configuração inválida: CLINIC_LINK_CODE_SECRET: obrigatória em staging/production (BR-CLN-20)");
  }
  if (result.data.NODE_ENV === "production" || result.data.NODE_ENV === "staging") {
    if (result.data.RATE_LIMIT_BACKEND === "memory") {
      throw new Error("Configuração inválida: RATE_LIMIT_BACKEND: 'memory' é proibido em staging/production (ADR-038)");
    }
    if (result.data.REDIS_URL === undefined) {
      throw new Error("Configuração inválida: REDIS_URL: obrigatória em staging/production (ADR-038)");
    }
    if (result.data.RATE_LIMIT_KEY_SECRET === undefined) {
      throw new Error("Configuração inválida: RATE_LIMIT_KEY_SECRET: obrigatória em staging/production (ADR-038)");
    }
  }
  if (result.data.AI_ASSISTANT_ENABLED && result.data.AI_SESSION_SECRET === undefined && (result.data.NODE_ENV === "production" || result.data.NODE_ENV === "staging")) {
    throw new Error("Configuração inválida: AI_SESSION_SECRET: obrigatória em staging/production com AI_ASSISTANT_ENABLED=true (ADR-039)");
  }
  return {
    ...result.data,
    CLINIC_LINK_CODE_SECRET: secret ?? DEV_CLINIC_LINK_CODE_SECRET,
    AI_SESSION_SECRET: result.data.AI_SESSION_SECRET ?? DEV_AI_SESSION_SECRET,
    RATE_LIMIT_KEY_SECRET: result.data.RATE_LIMIT_KEY_SECRET ?? DEV_RATE_LIMIT_KEY_SECRET,
    RATE_LIMIT_KEY_PREFIX: result.data.RATE_LIMIT_KEY_PREFIX ?? `vita:${result.data.NODE_ENV}`,
  };
}
