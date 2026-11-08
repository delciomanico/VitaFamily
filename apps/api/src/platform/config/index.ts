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
  SENTRY_DSN: z.string().optional(),
});

/** Valor só para `local`/`test` (nunca produção: `loadConfig` exige o segredo real em staging/production). */
const DEV_CLINIC_LINK_CODE_SECRET = "dev-only-clinic-link-code-secret-change-me";

export type Config = Readonly<Omit<z.infer<typeof envSchema>, "CLINIC_LINK_CODE_SECRET"> & { CLINIC_LINK_CODE_SECRET: string }>;

/** Nomes de variáveis cujo valor nunca deve ser registado em logs/erros (ver platform/logger). */
export const SENSITIVE_ENV_VARS = [
  "DATABASE_URL",
  "DATABASE_MAINTENANCE_URL",
  "S3_ACCESS_KEY",
  "S3_SECRET_KEY",
  "JWT_SIGNING_KEYS",
  "CLINIC_LINK_CODE_SECRET",
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
  return { ...result.data, CLINIC_LINK_CODE_SECRET: secret ?? DEV_CLINIC_LINK_CODE_SECRET };
}
