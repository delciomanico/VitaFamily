// Refresh token opaco do portal da clínica (ADR-020: duplicado de `auth/domain/token.ts` — mesma
// forma, 256 bits aleatórios, guardado hasheado; `node:crypto` é builtin, não é I/O banido).
import { createHash, randomBytes } from "node:crypto";

export function generateClinicOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashClinicOpaqueToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
