// Cursor opaco (base64url de JSON) da lista de marcações: `(startsAt, id)`. Inválido ⇒ `MALFORMED_REQUEST` (errors.md).
import { DomainError } from "../../../platform/errors/index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const malformed = (): DomainError => new DomainError("MALFORMED_REQUEST", { detail: "Cursor de paginação inválido." });

export function encodeBookingCursor(startsAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ s: startsAt.toISOString(), id }), "utf8").toString("base64url");
}

export function decodeBookingCursor(cursor: string): { startsAt: Date; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value === "object" && value !== null) {
      const { s, id } = value as { s?: unknown; id?: unknown };
      if (typeof s === "string" && typeof id === "string" && UUID.test(id)) {
        const startsAt = new Date(s);
        if (!Number.isNaN(startsAt.getTime())) return { startsAt, id };
      }
    }
  } catch {
    // cai no erro abaixo
  }
  throw malformed();
}
