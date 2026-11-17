// Cursores opacos (base64url de JSON). Inválidos ⇒ `MALFORMED_REQUEST` (errors.md: «cursor inválido»). Sem ids previsíveis nem texto.
import { DomainError } from "../../../platform/errors/index.js";

function malformed(): DomainError {
  return new DomainError("MALFORMED_REQUEST", { detail: "Cursor de paginação inválido." });
}

function parse(cursor: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value === "object" && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // cai no erro abaixo
  }
  throw malformed();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeSeqCursor(seq: number): string {
  return Buffer.from(JSON.stringify({ seq }), "utf8").toString("base64url");
}

export function decodeSeqCursor(cursor: string): number {
  const { seq } = parse(cursor);
  if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) throw malformed();
  return seq;
}

export function encodeConversationCursor(lastMessageAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: lastMessageAt.toISOString(), id }), "utf8").toString("base64url");
}

export function decodeConversationCursor(cursor: string): { lastMessageAt: Date; id: string } {
  const { at, id } = parse(cursor);
  if (typeof at !== "string" || typeof id !== "string" || !UUID.test(id)) throw malformed();
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) throw malformed();
  return { lastMessageAt: date, id };
}
