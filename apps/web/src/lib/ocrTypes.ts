/** Palavra reconhecida; `confidence` em 0–1 (o motor dá 0–100). */
export interface OcrWord {
  text: string
  confidence: number
}

/** Uma linha de texto reconhecida, com as palavras que a formam. */
export interface OcrLine {
  words: OcrWord[]
}

export const lineText = (line: OcrLine): string => line.words.map((w) => w.text).join(' ')

/** Linhas a partir de texto simples, com a mesma confiança em todas as palavras (testes e PDF com texto embutido). */
export function linesFromText(text: string, confidence = 1): OcrLine[] {
  return text
    .split(/\r?\n/)
    .map((raw) => ({ words: raw.split(/\s+/).filter(Boolean).map((word) => ({ text: word, confidence })) }))
    .filter((line) => line.words.length > 0)
}
