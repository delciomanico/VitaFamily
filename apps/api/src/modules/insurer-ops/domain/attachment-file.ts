// Ficheiros dos anexos administrativos (BR-AUT-13): tipo verificado pelo CONTEÚDO (nunca pela extensão/Content-Type), ≤ 10 MB.
// `insurer-ops` não importa `documents` (modules.md nota 31d): detecção própria, mínima (PDF, JPEG, PNG).

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENTS_PER_REQUEST = 5;

export type AttachmentMime = "application/pdf" | "image/jpeg" | "image/png";

export function detectAttachmentMime(buffer: Buffer): AttachmentMime | null {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}

const EXTENSION: Record<AttachmentMime, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };

/** Chave no `Storage`: sem o nome original (pode ter dados pessoais). */
export function attachmentStorageKey(insurerId: string, attachmentId: string, mime: AttachmentMime): string {
  return `insurer-attachments/${insurerId}/${attachmentId}.${EXTENSION[mime]}`;
}
