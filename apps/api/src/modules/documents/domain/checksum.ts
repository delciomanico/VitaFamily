// Checksum do ficheiro (entities.md DM7: `checksumSha256`) — `node:crypto` é builtin, não é
// biblioteca de I/O (conventions.md §3.9), mesmo critério de `auth/domain/token.ts`.
import { createHash } from "node:crypto";

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
