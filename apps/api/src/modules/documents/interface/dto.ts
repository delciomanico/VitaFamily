// Mapeamento das vistas da application -> forma da API (components.schemas.Document, openapi.yaml).
import type { Document } from "../domain/document.js";

export function toDocumentResponse(document: Document) {
  return {
    id: document.id,
    resourceType: document.resourceType,
    resourceId: document.resourceId,
    originalName: document.originalName,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    scanStatus: document.scanStatus,
    createdAt: document.createdAt.toISOString(),
  };
}

/**
 * `Content-Disposition: attachment` (endpoints.md `downloadDocument`) com nome seguro para
 * cabeçalhos HTTP (ASCII, aspas escapadas) e `filename*` (RFC 5987) para nomes com acentos/Unicode
 * — `originalName` vem do utilizador, nunca confiar nele sem escapar.
 */
export function contentDispositionHeader(originalName: string): string {
  const asciiFallback = originalName.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`;
}
