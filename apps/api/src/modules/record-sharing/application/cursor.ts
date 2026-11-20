// Cursores opacos (base64url de JSON). Inválido ⇒ `MALFORMED_REQUEST` (errors.md).
import { DomainError } from "../../../platform/errors/index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const malformed = (): DomainError => new DomainError("MALFORMED_REQUEST", { detail: "Cursor de paginação inválido." });

function parse(cursor: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value === "object" && value !== null) return value as Record<string, unknown>;
  } catch {
    // cai no erro abaixo
  }
  throw malformed();
}

/** Lista de partilhas: `(createdAt, id)`. */
export function encodeShareCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ c: createdAt.toISOString(), id }), "utf8").toString("base64url");
}

export function decodeShareCursor(cursor: string): { createdAt: Date; id: string } {
  const { c, id } = parse(cursor);
  if (typeof c === "string" && typeof id === "string" && UUID.test(id)) {
    const createdAt = new Date(c);
    if (!Number.isNaN(createdAt.getTime())) return { createdAt, id };
  }
  throw malformed();
}

/** Vistas: `viewNo` (sequencial por partilha, decrescente). */
export function encodeViewCursor(viewNo: number): string {
  return Buffer.from(JSON.stringify({ n: viewNo }), "utf8").toString("base64url");
}

export function decodeViewCursor(cursor: string): number {
  const { n } = parse(cursor);
  if (typeof n === "number" && Number.isInteger(n) && n >= 1) return n;
  throw malformed();
}
