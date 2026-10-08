// Configuração por variáveis de ambiente — lista e grupos: docs/10-operations/environment.md §2.
// Validada no arranque (falha rápida se faltar/for inválida uma variável obrigatória); os valores
// nunca são registados em logs (ver platform/logger, campos sensíveis redigidos).
import { z } from "zod";

const envSchema = z.object({
  // Aplicação
  NODE_ENV: z.enum(["local", "test", "staging", "production"]).default("local"),
  PORT: z.coerce.number().int().positive().default(8080),
  APP_BASE_URL: z.string().url().default("http://localhost:8080"),
  PWA_ORIGIN: z.string().default(""),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  TERMS_VERSION: z.string().min(1, "TERMS_VERSION é obrigatória (B6)"),

  // Base de dados
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  DATABASE_MAINTENANCE_URL: z.string().optional(),

  // Armazenamento (MinIO/S3)
  S3_ENDPOINT: z.string().min(1, "S3_ENDPOINT é obrigatória"),
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
  METRICS_ENABLED: z.coerce.boolean().default(false),
  SENTRY_DSN: z.string().optional(),
});

export type Config = Readonly<z.infer<typeof envSchema>>;

/** Nomes de variáveis cujo valor nunca deve ser registado em logs/erros (ver platform/logger). */
export const SENSITIVE_ENV_VARS = [
  "DATABASE_URL",
  "DATABASE_MAINTENANCE_URL",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "JWT_SIGNING_KEYS",
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
  return result.data;
}
