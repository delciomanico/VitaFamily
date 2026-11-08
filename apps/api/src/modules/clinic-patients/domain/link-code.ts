// Código/QR de ligação (BR-CLN-20): 8 caracteres sem 0 O 1 I L, uso único, 10 min, guardado só como
// HMAC-SHA256 do código normalizado. `node:crypto` é computação pura (conventions.md §3.2). Sem I/O de rede/BD.
import { createHmac, randomInt } from "node:crypto";
import { ValidationError } from "../../../platform/errors/index.js";

export const LINK_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 8;
export const LINK_CODE_TTL_MS = 10 * 60 * 1000;
/** BR-CLN-20: 5 códigos/hora por membro. */
export const LINK_CODE_MEMBER_RULE = { max: 5, windowMs: 60 * 60 * 1000 };
/** Entradas aceites: exatamente o alfabeto gerado (o `pattern` do contrato aceitaria também `L`, BR-CLN-20 não). */
const CODE_PATTERN = new RegExp(`^[${LINK_CODE_ALPHABET}]{${String(LINK_CODE_LENGTH)}}$`);

/** Sorteio uniforme (`randomInt` evita enviesamento por módulo). */
export function generateLinkCode(): string {
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) {
    code += LINK_CODE_ALPHABET.charAt(randomInt(LINK_CODE_ALPHABET.length));
  }
  return code;
}

/** Maiúsculas, sem hífen nem espaços; formato inválido => `VALIDATION_ERROR` (nunca ecoa o valor). */
export function normalizeLinkCode(raw: unknown): string {
  const code = typeof raw === "string" ? raw.replace(/[-\s]/g, "").toUpperCase() : "";
  if (!CODE_PATTERN.test(code)) {
    throw new ValidationError([{ field: "code", message: "formato inválido" }], { detail: "Código inválido." });
  }
  return code;
}

export function hashLinkCode(secret: string, normalizedCode: string): string {
  return createHmac("sha256", secret).update(normalizedCode, "utf8").digest("hex");
}

/** Apresentação `XXXX-XXXX` (o hífen é ignorado ao consumir). */
export function formatLinkCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}
