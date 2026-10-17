import { isValidISODate } from './date'

/*
 * Leitura de texto (OCR) é sempre melhor esforço: o texto reconhecido tem erros e falta de
 * formatação, por isso cada função aqui devolve `null`/`[]` em vez de adivinhar. Quem chama só
 * pré-preenche campos vazios e mostra sempre o formulário normal para o utilizador rever e
 * corrigir antes de guardar — nunca se submete nada sem confirmação.
 */

const MONTHS = 12

/** Primeira data reconhecida no texto (dd/mm/aaaa, dd-mm-aa, ...), em ISO; null se nada plausível. */
export function extractDateISO(text: string): string | null {
  const match = text.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/)
  if (!match) return null
  const [, dayStr, monthStr, yearStr] = match
  const day = Number(dayStr)
  const month = Number(monthStr)
  const year = yearStr!.length === 2 ? 2000 + Number(yearStr) : Number(yearStr)
  if (month < 1 || month > MONTHS || day < 1 || day > 31) return null
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isValidISODate(iso) ? iso : null
}

/** Nome depois de “Dr.”, “Dra.” ou “Doutor(a)”; null se não encontrar. */
export function extractDoctorName(text: string): string | null {
  const match = text.match(/(?:Dr\.?a?\.?|Doutor(?:a)?)\s+([A-ZÀ-Ý][\p{L}.' -]{2,40})/u)
  return match?.[1]?.trim().replace(/[.,;:]+$/, '') ?? null
}

/** Linha que parece nomear uma clínica, centro de saúde, hospital ou laboratório. */
export function extractClinicName(text: string): string | null {
  const line = text.split(/\r?\n/).find((l) => /cl[íi]nica|centro de sa[úu]de|hospital|laborat[óo]rio/i.test(l))
  return line?.trim().replace(/\s{2,}/g, ' ') || null
}

/** Primeiro “nome do medicamento + dosagem” plausível (ex.: “Amoxicilina 500 mg”); null se não encontrar. */
export function extractMedication(text: string): { name: string; dosage: string } | null {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-ZÀ-Ý][\p{L}çãõáéíóúâêôàü -]{1,40}?)\s+(\d+(?:[.,]\d+)?\s?(?:mg|ml|mcg|g|ui))\b/iu)
    if (match) return { name: match[1]!.trim(), dosage: match[2]!.trim() }
  }
  return null
}

const EXAM_LINE_IGNORE = /paciente|utente|exame|resultado|data|m[ée]dico|requisi[cç][aã]o|laborat[óo]rio/i

/** Linhas tipo “Glicemia 98 mg/dL (70-99)” → até `max` resultados; melhor esforço, pode vir vazio. */
export function extractExamResults(
  text: string,
  max = 5,
): { parameter: string; value: string; unit: string }[] {
  const results: { parameter: string; value: string; unit: string }[] = []
  for (const line of text.split(/\r?\n/)) {
    if (EXAM_LINE_IGNORE.test(line)) continue
    const match = line.match(
      /^\s*([A-ZÀ-Ý][\p{L} .çãõáéíóúâêôàü]{2,30}?)\s+(\d+(?:[.,]\d+)?)\s*([a-zA-Zµ%/]{0,10})?\b/u,
    )
    if (!match) continue
    results.push({ parameter: match[1]!.trim(), value: match[2]!.replace(',', '.'), unit: (match[3] ?? '').trim() })
    if (results.length >= max) break
  }
  return results
}
