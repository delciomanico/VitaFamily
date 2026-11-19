// Validação do texto livre de MK3 (BR-MKT-51/52/63): rótulo do participante (1–40) e notas (≤ 300). Texto simples, aparado, sem caracteres de
// controlo (exceto `\n`/`\t` nas notas). As mensagens de erro nunca repetem o texto recebido (dado potencialmente sensível).

export const TEXT_LIMITS = { participantLabel: 40, note: 300, meetingInfo: 300, reason: 300 } as const;

export type TextError = "EMPTY" | "TOO_LONG" | "CONTROL_CHARACTER";
export type TextResult = { ok: true; text: string } | { ok: false; error: TextError };

// eslint-disable-next-line no-control-regex
const CONTROL_STRICT = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const CONTROL_MULTILINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

const length = (text: string): number => Array.from(text).length;

/** Rótulo do participante: linha única, 1–40 pontos de código depois de aparado. */
export function validateParticipantLabel(raw: string): TextResult {
  const text = raw.trim();
  if (CONTROL_STRICT.test(text)) return { ok: false, error: "CONTROL_CHARACTER" };
  const n = length(text);
  if (n < 1) return { ok: false, error: "EMPTY" };
  if (n > TEXT_LIMITS.participantLabel) return { ok: false, error: "TOO_LONG" };
  return { ok: true, text };
}

/** Texto livre opcional (nota, motivo, ligação): aparado; vazio ⇒ `null`; ≤ `max` pontos de código. */
export function validateOptionalFreeText(raw: string | null | undefined, max: number): { ok: true; text: string | null } | { ok: false; error: TextError } {
  if (raw === null || raw === undefined) return { ok: true, text: null };
  const text = raw.replace(/\r\n?/g, "\n").trim();
  if (CONTROL_MULTILINE.test(text)) return { ok: false, error: "CONTROL_CHARACTER" };
  if (text.length === 0) return { ok: true, text: null };
  if (length(text) > max) return { ok: false, error: "TOO_LONG" };
  return { ok: true, text };
}

/** Texto livre obrigatório (motivo da recusa/cancelamento do profissional): como o opcional, mas vazio é erro. */
export function validateRequiredFreeText(raw: string | null | undefined, max: number): TextResult {
  const result = validateOptionalFreeText(raw, max);
  if (!result.ok) return result;
  return result.text === null ? { ok: false, error: "EMPTY" } : { ok: true, text: result.text };
}

/** E-mail normalizado para a comparação do `SelfDealingGuard` (BR-MKT-62): aparado, minúsculas, NFC. */
export function normalizeEmailForComparison(email: string): string {
  return email.trim().toLowerCase().normalize("NFC");
}
