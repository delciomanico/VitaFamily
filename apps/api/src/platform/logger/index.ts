// Logger JSON (pino) com redação de campos sensíveis (conventions.md §3.7): nunca registar
// dados de saúde, tokens, palavras-passe nem corpos de pedidos.
import type { Writable } from "node:stream";
import pino, { type Logger } from "pino";

export const REDACTED = "[REDACTED]";

/**
 * Nomes de campos (em qualquer objeto passado ao logger) cujo valor é sempre redigido — ver
 * `platform/config` (`SENSITIVE_ENV_VARS`) e o catálogo equivalente do antigo `logx` (ADR-012).
 * Cobrem-se os dois primeiros níveis de profundidade (suficiente para `req.headers.*`/`req.body.*`);
 * módulos com campos adicionais passam `redactPaths` extra a `createLogger`.
 */
const DEFAULT_SENSITIVE_KEYS = [
  "password",
  "newPassword",
  "currentPassword",
  "token",
  "accessToken",
  "refreshToken",
  "idToken",
  "authorization",
  "cookie",
  "secret",
  "apiKey",
  "smtpUrl",
  "databaseUrl",
  "s3SecretKey",
  "jwtSigningKeys",
  "vapidPrivateKey",
  "body",
  "notes",
  "note",
  "diagnosis",
  "allergy",
  "condition",
  "medication",
  "dosage",
  "result",
  "health",
] as const;

function defaultRedactPaths(): string[] {
  const paths: string[] = [];
  for (const key of DEFAULT_SENSITIVE_KEYS) {
    paths.push(key, `*.${key}`, `req.headers["${key.toLowerCase()}"]`);
  }
  paths.push('res.headers["set-cookie"]');
  return paths;
}

export interface CreateLoggerOptions {
  level?: string;
  /** Caminhos adicionais (sintaxe de `pino.redact`) para redigir, além da lista por defeito. */
  redactPaths?: string[];
  /** Destino alternativo (só para testes); por defeito `process.stdout`. */
  destination?: Writable;
}

/** Cria o logger JSON da aplicação, com redação aplicada. */
export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const opts = {
    level: options.level ?? "info",
    redact: {
      paths: [...defaultRedactPaths(), ...(options.redactPaths ?? [])],
      censor: REDACTED,
    },
  };
  return options.destination ? pino(opts, options.destination) : pino(opts);
}

/**
 * Marca um valor para ser sempre redigido quando serializado em log, seja qual for a chave sob a
 * qual é colocado (equivalente ao `logx.Secret` do ADR-012) — útil quando o nome do campo não está
 * na lista por defeito (ex.: um valor de negócio ocasionalmente sensível).
 */
export class Secret {
  constructor(private readonly value: unknown) {}

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  /** Acesso explícito ao valor original (nunca o registar). */
  reveal(): unknown {
    return this.value;
  }
}

export type { Logger } from "pino";
