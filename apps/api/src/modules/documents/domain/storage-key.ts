// Construção da `storage_key` (schema.md §3, ADR-006: "prefixo de quarentena até o ClamAV os
// aprovar"). Nunca deriva de `originalName` (entrada não confiável — evita travessia de caminho);
// só do `documentId` (UUID gerado pela aplicação) e do tipo detetado pelo conteúdo
// (`domain/file-type.ts`). Puro, sem I/O.
import type { FileKind } from "./file-type.js";

const EXTENSION_BY_KIND: Record<FileKind, string> = { PDF: "pdf", JPG: "jpg", PNG: "png" };

/** Chave inicial, antes do antivírus aprovar (ADR-006). */
export function quarantineStorageKey(documentId: string, kind: FileKind): string {
  return `quarantine/${documentId}.${EXTENSION_BY_KIND[kind]}`;
}

/** Chave final, depois de `scan_status` passar a `CLEAN` (worker `documents.scan`). */
export function finalStorageKey(documentId: string, kind: FileKind): string {
  return `documents/${documentId}.${EXTENSION_BY_KIND[kind]}`;
}
