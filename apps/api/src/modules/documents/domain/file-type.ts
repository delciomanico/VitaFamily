// Validação de tipo por CONTEÚDO (BR-DOC-01: "tipo verificado pelo conteúdo", não pela extensão ou
// pelo `Content-Type` declarado pelo cliente — um `.pdf` que é na verdade um executável tem de ser
// recusado, AC-DOC-03). Puro, sem I/O: só lê os primeiros bytes (magic bytes/assinatura de
// ficheiro) do buffer já em memória.
export type FileKind = "PDF" | "JPG" | "PNG";

/** Assinaturas (magic bytes) dos 3 tipos permitidos (BR-DOC-01, FR-DOC-02). */
const SIGNATURES: Record<FileKind, readonly number[]> = {
  PDF: [0x25, 0x50, 0x44, 0x46, 0x2d], // "%PDF-"
  JPG: [0xff, 0xd8, 0xff],
  PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

const MIME_TYPE_BY_KIND: Record<FileKind, string> = {
  PDF: "application/pdf",
  JPG: "image/jpeg",
  PNG: "image/png",
};

function matchesSignature(buffer: Buffer, signature: readonly number[]): boolean {
  if (buffer.length < signature.length) {
    return false;
  }
  return signature.every((byte, index) => buffer[index] === byte);
}

/** Devolve o tipo detetado pelo conteúdo, ou `null` se não for PDF/JPG/PNG (FILE_TYPE_NOT_ALLOWED). */
export function detectFileKind(buffer: Buffer): FileKind | null {
  for (const kind of Object.keys(SIGNATURES) as FileKind[]) {
    if (matchesSignature(buffer, SIGNATURES[kind])) {
      return kind;
    }
  }
  return null;
}

/** `mime_type` guardado em `documents` — derivado do conteúdo, nunca do valor declarado pelo cliente. */
export function mimeTypeForFileKind(kind: FileKind): string {
  return MIME_TYPE_BY_KIND[kind];
}
