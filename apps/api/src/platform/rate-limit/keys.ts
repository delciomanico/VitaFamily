// Construção das chaves: `{prefixo}:rl:v1:{namespace}:{regra}:{sujeito}` (ADR-038 §4). Sem PII em claro.
import { createHmac } from "node:crypto";
import type { RateLimitKey } from "./port.js";

const NAMESPACE = /^[a-z0-9][a-z0-9-]*$/;
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
  const subject = key.pii === true ? hashSubject(options.secret, key.subject) : key.subject;
  return `${options.prefix}:rl:v1:${options.namespace}:${key.rule}:${subject}`;
}
