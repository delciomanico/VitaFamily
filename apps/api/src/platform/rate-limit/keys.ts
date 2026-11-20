// Construção das chaves: `{prefixo}:rl:v1:{namespace}:{regra}:{sujeito}` (ADR-038 §4). Sem PII em claro.
import { createHmac } from "node:crypto";
import type { RateLimitKey } from "./port.js";

const NAMESPACE = /^[a-z0-9][a-z0-9-]*$/;
const PLAIN_SUBJECT = /^[A-Za-z0-9-]+$/;
const RULE = /^[a-z0-9][a-z0-9._-]*$/;

export function assertNamespace(namespace: string): void {
  if (!NAMESPACE.test(namespace)) {
    throw new Error(`Namespace de rate limiting inválido: "${namespace}"`);
  }
}

/** HMAC-SHA256 truncado a 32 hex. */
export function hashSubject(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}

export function buildRateLimitKey(options: { prefix: string; namespace: string; secret: string }, key: RateLimitKey): string {
  if (!RULE.test(key.rule)) {
    throw new Error(`Regra de rate limiting inválida: "${key.rule}"`);
  }
  if (key.pii !== true && !PLAIN_SUBJECT.test(key.subject)) {
    throw new Error(
      `Sujeito de rate limiting inválido para a regra "${key.rule}": sem pii só [A-Za-z0-9-] (use pii: true para e-mail/IP/texto livre)`,
    );
  }
  const subject = key.pii === true ? hashSubject(options.secret, key.subject) : key.subject;
  return `${options.prefix}:rl:v1:${options.namespace}:${key.rule}:${subject}`;
}
