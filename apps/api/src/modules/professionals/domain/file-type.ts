// Validação de tipo de ficheiro por CONTEÚDO (BR-MKT-17, como BR-DOC-01): só os primeiros bytes (assinatura), nunca a extensão nem o
// `Content-Type` declarado. Duplicado de `documents` (OP-58: `documents` não é importada). Puro, sem I/O.
export type FileKind = "PDF" | "JPG" | "PNG";

const SIGNATURES: Record<FileKind, readonly number[]> = {
  PDF: [0x25, 0x50, 0x44, 0x46, 0x2d], // "%PDF-"
  JPG: [0xff, 0xd8, 0xff],
  PNG: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
};

export const MIME_BY_KIND: Record<FileKind, "application/pdf" | "image/jpeg" | "image/png"> = { PDF: "application/pdf", JPG: "image/jpeg", PNG: "image/png" };
const EXTENSION_BY_KIND: Record<FileKind, string> = { PDF: "pdf", JPG: "jpg", PNG: "png" };

export function detectFileKind(buffer: Buffer): FileKind | null {
  for (const kind of Object.keys(SIGNATURES) as FileKind[]) {
    const signature = SIGNATURES[kind];
    if (buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte)) return kind;
  }
  return null;
}

/** Chaves de armazenamento: nunca derivam do nome do ficheiro (entrada não confiável); só do id gerado pela aplicação. */
export function quarantineKey(credentialId: string, kind: FileKind): string {
  return `professional-credentials/quarantine/${credentialId}.${EXTENSION_BY_KIND[kind]}`;
}

export function finalKey(credentialId: string, kind: FileKind): string {
  return `professional-credentials/final/${credentialId}.${EXTENSION_BY_KIND[kind]}`;
}
