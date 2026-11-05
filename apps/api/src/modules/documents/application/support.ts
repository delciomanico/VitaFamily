// Auxiliares partilhados pelos casos de uso de `documents` (mesmo critério de
// `health-records/application/support.ts`).
import type { DataCategory } from "../../access/index.js";
import type { Document, ResourceType } from "../domain/document.js";
import type { DocumentsDeps, DownloadStream } from "./ports.js";

/**
 * BR-CLN-08: documentos emitidos pela clínica só são visíveis/descarregáveis pelo paciente com o
 * exame `COMPLETED` (via `ReleaseGatePort`); os restantes não dependem disto. Falha fechada se a
 * porta não estiver ligada.
 */
export async function isVisibleToPatient<Trx>(deps: DocumentsDeps<Trx>, trx: Trx, document: Document): Promise<boolean> {
  if (!document.uploadedByClinic) {
    return true;
  }
  return deps.releaseGate ? deps.releaseGate.isReleased(trx, document) : false;
}

/**
 * Entrada de `AccessPolicy.can()` para uma operação sobre um documento de `resourceType`:
 * `PRESCRIPTION`/`EXAMINATION` autorizam por categoria; `INSURANCE_POLICY` (foto do cartão, ADR-021/
 * BR-INS-02) não é categoria — só `SELF`/`TUTOR_OF`, via `MANAGE_INSURANCE` (leitura e escrita).
 */
export function accessInputFor(resourceType: ResourceType, operation: "READ" | "CREATE" | "DELETE"): { action: "MANAGE_INSURANCE" } | { action: "READ" | "CREATE" | "DELETE"; category: DataCategory } {
  if (resourceType === "INSURANCE_POLICY") {
    return { action: "MANAGE_INSURANCE" };
  }
  return { action: operation, category: categoryForResourceType(resourceType) };
}

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
