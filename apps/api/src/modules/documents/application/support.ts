// Auxiliares partilhados pelos casos de uso de `documents` (mesmo critério de
// `health-records/application/support.ts`).
import type { DataCategory } from "../../access/index.js";
import type { ResourceType } from "../domain/document.js";
import type { DownloadStream } from "./ports.js";

/**
 * Deriva a categoria de autorização a partir do tipo do recurso associado (CLAUDE.md/prompt §29:
 * decisão já tomada pelo proprietário, não re-decidir): `PRESCRIPTION` -> `MEDICATION`,
 * `EXAMINATION` -> `EXAMS` (authorization.md §3, `access.policy.can()`). Funciona independentemente
 * de `prescriptions`/`examinations` existirem como tabelas (só chegam em M6/M7).
 */
export function categoryForResourceType(resourceType: ResourceType): DataCategory {
  return resourceType === "PRESCRIPTION" ? "MEDICATION" : "EXAMS";
}

/** Lê um stream completo para memória — usado só pelo worker `documents.scan` (ficheiros ≤10 MB). */
export async function readableToBuffer(stream: DownloadStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}
