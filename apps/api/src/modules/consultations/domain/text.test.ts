// Validação do texto livre de MK3 (BR-MKT-51/52/63): rótulo (1–40 pontos de código), notas (≤ 300), normalização do e-mail (BR-MKT-62).
import { describe, expect, it } from "vitest";
import { normalizeEmailForComparison, TEXT_LIMITS, validateOptionalFreeText, validateParticipantLabel, validateRequiredFreeText } from "./text.js";

describe("validateParticipantLabel (BR-MKT-51: 1–40 pontos de código, aparado, linha única)", () => {
  it.each([
    ["Ana", "Ana"],
    ["  Ana  ", "Ana"],
    ["a", "a"],
    ["João Mãe", "João Mãe"],
    ["A".repeat(40), "A".repeat(40)],
    ["😀".repeat(40), "😀".repeat(40)],
    ["Ana 😀", "Ana 😀"],
  ])("aceita %j como %j", (raw, expected) => {
    expect(validateParticipantLabel(raw)).toEqual({ ok: true, text: expected });
  });

  it.each([
    ["", "EMPTY"],
    ["   ", "EMPTY"],
    ["\t \t", "EMPTY"],
    ["A".repeat(41), "TOO_LONG"],
    ["😀".repeat(41), "TOO_LONG"],
    ["A".repeat(39) + "ÇÃ", "TOO_LONG"],
    ["Ana\nSilva", "CONTROL_CHARACTER"],
    ["Ana\tSilva", "CONTROL_CHARACTER"],
    ["Ana\u0000", "CONTROL_CHARACTER"],
    ["Ana\u007F", "CONTROL_CHARACTER"],
    ["Ana\rSilva", "CONTROL_CHARACTER"],
  ])("recusa %j com %s", (raw, error) => {
    expect(validateParticipantLabel(raw)).toEqual({ ok: false, error });
  });

  it("conta pontos de código e não unidades UTF-16: 40 emojis são aceites, 41 não", () => {
    expect("😀".length).toBe(2);
    expect(validateParticipantLabel("😀".repeat(TEXT_LIMITS.participantLabel)).ok).toBe(true);
    expect(validateParticipantLabel("😀".repeat(TEXT_LIMITS.participantLabel + 1))).toEqual({ ok: false, error: "TOO_LONG" });
  });
});

describe("validateOptionalFreeText (notas e ligações: aparado, vazio ⇒ null, \\n permitido, controlo recusado)", () => {
  it.each([null, undefined])("%s ⇒ null sem erro", (raw) => {
    expect(validateOptionalFreeText(raw, 300)).toEqual({ ok: true, text: null });
  });

  it.each(["", "   ", " \n\t ", "\r\n"])("vazio ou só espaços (%j) ⇒ null", (raw) => {
    expect(validateOptionalFreeText(raw, 300)).toEqual({ ok: true, text: null });
  });

  it("preserva quebras de linha internas e normaliza CRLF para LF", () => {
    expect(validateOptionalFreeText("primeira\nsegunda", 300)).toEqual({ ok: true, text: "primeira\nsegunda" });
    expect(validateOptionalFreeText("primeira\r\nsegunda\rterceira", 300)).toEqual({ ok: true, text: "primeira\nsegunda\nterceira" });
  });

  it("aparado nas extremidades e tabulações internas aceites", () => {
    expect(validateOptionalFreeText("  a\tb  ", 300)).toEqual({ ok: true, text: "a\tb" });
  });

  it.each(["a\u0000b", "a\u0007b", "a\u001Bb", "a\u007Fb"])("controlo %j recusado", (raw) => {
    expect(validateOptionalFreeText(raw, 300)).toEqual({ ok: false, error: "CONTROL_CHARACTER" });
  });

  it("aceita exatamente max pontos de código e recusa max + 1", () => {
    expect(validateOptionalFreeText("a".repeat(300), 300)).toEqual({ ok: true, text: "a".repeat(300) });
    expect(validateOptionalFreeText("a".repeat(301), 300)).toEqual({ ok: false, error: "TOO_LONG" });
  });

  it("conta emojis como um ponto de código cada", () => {
    expect(validateOptionalFreeText("😀".repeat(300), 300).ok).toBe(true);
    expect(validateOptionalFreeText("😀".repeat(301), 300)).toEqual({ ok: false, error: "TOO_LONG" });
  });

  it("o limite é o passado: aceita 1 ponto com max = 1", () => {
    expect(validateOptionalFreeText("x", 1)).toEqual({ ok: true, text: "x" });
    expect(validateOptionalFreeText("xy", 1)).toEqual({ ok: false, error: "TOO_LONG" });
  });
});

describe("validateRequiredFreeText (motivo obrigatório: como o opcional, mas vazio é erro)", () => {
  it.each([null, undefined, "", "   ", "\n"])("%j ⇒ EMPTY", (raw) => {
    expect(validateRequiredFreeText(raw, 300)).toEqual({ ok: false, error: "EMPTY" });
  });

  it("aceita texto aparado", () => {
    expect(validateRequiredFreeText("  Horário incompatível  ", 300)).toEqual({ ok: true, text: "Horário incompatível" });
  });

  it("propaga CONTROL_CHARACTER e TOO_LONG do opcional", () => {
    expect(validateRequiredFreeText("a\u0000", 300)).toEqual({ ok: false, error: "CONTROL_CHARACTER" });
    expect(validateRequiredFreeText("a".repeat(301), 300)).toEqual({ ok: false, error: "TOO_LONG" });
  });
});

describe("normalizeEmailForComparison (BR-MKT-62: aparado, minúsculas, NFC)", () => {
  it("apara e põe em minúsculas", () => {
    expect(normalizeEmailForComparison("  Ana.Silva@Exemplo.AO \t")).toBe("ana.silva@exemplo.ao");
  });

  it("'é' composto e decomposto (NFD) ficam iguais e saem em NFC", () => {
    const composed = "josé@exemplo.ao";
    const decomposed = "josé@exemplo.ao";
    expect(composed).not.toBe(decomposed);
    expect(normalizeEmailForComparison(decomposed)).toBe(normalizeEmailForComparison(composed));
    expect(normalizeEmailForComparison(decomposed)).toBe("josé@exemplo.ao");
  });

  it("e-mails realmente diferentes continuam diferentes", () => {
    expect(normalizeEmailForComparison("ana@exemplo.ao")).not.toBe(normalizeEmailForComparison("ana2@exemplo.ao"));
  });
});
