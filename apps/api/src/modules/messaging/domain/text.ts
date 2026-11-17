// Texto das mensagens e campos livres das conversas (BR-MKT-39/44, OP-75). Puro: sem I/O. O conteúdo é dado de saúde potencial (BR-MKT-46):
// os erros devolvem só códigos, nunca o texto recebido.

export const MESSAGE_MIN_CHARS = 1;
export const MESSAGE_MAX_CHARS = 1000;
export const PARTICIPANT_LABEL_MAX_CHARS = 40;
export const REPORT_NOTE_MAX_CHARS = 300;

export type TextError = "EMPTY" | "TOO_LONG" | "CONTROL_CHARACTER";

export type TextResult = { ok: true; text: string } | { ok: false; error: TextError };

/** Controlo C0/C1 e DEL; `allowNewline` aceita só `\n` (mensagens e notas; o `participantLabel` é de uma linha). */
function hasControl(text: string, allowNewline: boolean): boolean {
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 10 && allowNewline) continue;
    if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
}

/** Comprimento em pontos de código Unicode (não em unidades UTF-16). */
export function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** `\r\n` e `\r` passam a `\n` (clientes diferentes) antes de validar. */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Mensagem: aparada, 1–1000 pontos de código, sem controlo exceto `\n`. */
export function validateMessageText(raw: string): TextResult {
  const text = normalizeNewlines(raw).trim();
  if (hasControl(text, true)) return { ok: false, error: "CONTROL_CHARACTER" };
  const length = codePointLength(text);
  if (length < MESSAGE_MIN_CHARS) return { ok: false, error: "EMPTY" };
  if (length > MESSAGE_MAX_CHARS) return { ok: false, error: "TOO_LONG" };
  return { ok: true, text };
}

/** `participantLabel`: 1–40 caracteres, uma linha, sem controlo (escolhido pela família ao abrir; OP-75). */
export function validateParticipantLabel(raw: string): TextResult {
  const text = raw.trim();
  if (hasControl(text, false)) return { ok: false, error: "CONTROL_CHARACTER" };
  const length = codePointLength(text);
  if (length < 1) return { ok: false, error: "EMPTY" };
  if (length > PARTICIPANT_LABEL_MAX_CHARS) return { ok: false, error: "TOO_LONG" };
  return { ok: true, text };
}

/** Nota opcional da denúncia (≤ 300); vazia depois de aparada = sem nota (`null`). */
export function validateReportNote(raw: string | null | undefined): { ok: true; note: string | null } | { ok: false; error: TextError } {
  if (raw === null || raw === undefined) return { ok: true, note: null };
  const text = normalizeNewlines(raw).trim();
  if (hasControl(text, true)) return { ok: false, error: "CONTROL_CHARACTER" };
  if (text.length === 0) return { ok: true, note: null };
  if (codePointLength(text) > REPORT_NOTE_MAX_CHARS) return { ok: false, error: "TOO_LONG" };
  return { ok: true, note: text };
}
