import { isValidISODate } from './date'
import { CONFIDENCE_THRESHOLD } from './ocrConfig'
import { lineText, type OcrLine } from './ocrTypes'

/*
 * Extração de campos de receitas e laudos (BR-OCR-06). É sempre melhor esforço e só transcrição: copia-se o que o
 * documento diz, sem catálogo de medicamentos nem de exames, sem normalizar, completar ou sugerir; campo não
 * encontrado fica ausente (nunca inventado). Cada campo leva a confiança (BR-OCR-07) = média das palavras que o
 * originaram. Funções puras, sem rede nem efeitos: o texto reconhecido nunca é registado (BR-OCR-12).
 */

/** Campo extraído: o valor e a confiança (0–1) das palavras de que veio. */
export interface Field<T = string> {
  value: T
  confidence: number
}

export interface DraftFrequency {
  /** Como está escrito no documento (ex.: «de 8 em 8 horas»). */
  text: string
  /** «De X em X horas», quando X é um dos intervalos que a app suporta. */
  intervalHours?: number
  /** «N vezes por dia» (1–4), para horários fixos. */
  perDay?: number
}

export interface DraftMedication {
  name: Field
  dosage?: Field
  frequency?: Field<DraftFrequency>
  duration?: Field<{ days?: number; continuous: boolean }>
  notes?: Field
}

export interface PrescriptionDraft {
  issuedOn?: Field
  doctorName?: Field
  clinicName?: Field
  notes?: Field
  medications: DraftMedication[]
}

export interface DraftResult {
  parameter: Field
  /** Valor tal como no documento (número com vírgula ou texto, ex.: «Negativo»). */
  value: Field
  unit?: Field
  referenceMin?: Field
  referenceMax?: Field
  /** Referência em texto, quando não é um intervalo (ex.: «Negativo»). */
  referenceText?: Field
}

export interface ExamDraft {
  name?: Field
  examDate?: Field
  labName?: Field
  results: DraftResult[]
}

/** Há alguma coisa útil para pré-preencher? Se não, é falha graciosa (BR-OCR-10). */
export function hasUsefulFields(draft: PrescriptionDraft | ExamDraft): boolean {
  if ('medications' in draft) return draft.medications.length > 0 || !!(draft.issuedOn || draft.doctorName || draft.clinicName)
  return draft.results.length > 0 || !!(draft.name || draft.examDate || draft.labName)
}

export const needsConfirmation = (confidence: number): boolean => confidence < CONFIDENCE_THRESHOLD

// ---------------------------------------------------------------------------------------------------------------
// Documento: linhas com a posição em texto corrido, para dar a confiança por intervalo de caracteres.

interface Doc {
  lines: { text: string; start: number }[]
  /** Média da confiança das palavras que tocam [start, end). */
  confidence(start: number, end: number): number
}

function buildDoc(input: OcrLine[]): Doc {
  const lines: Doc['lines'] = []
  const words: { start: number; end: number; confidence: number }[] = []
  let offset = 0
  for (const line of input) {
    const text = lineText(line)
    let cursor = offset
    for (const word of line.words) {
      words.push({ start: cursor, end: cursor + word.text.length, confidence: word.confidence })
      cursor += word.text.length + 1
    }
    lines.push({ text, start: offset })
    offset += text.length + 1
  }
  return {
    lines,
    confidence(start, end) {
      const hit = words.filter((w) => w.start < end && w.end > start)
      return hit.length === 0 ? 0 : hit.reduce((sum, w) => sum + w.confidence, 0) / hit.length
    },
  }
}

const clean = (value: string) => value.replace(/\s{2,}/g, ' ').replace(/^[\s:;,.\-–—|_~*!?]+|[\s:;,\-–—|_~*!?]+$/g, '').trim()

/** Campo cujo valor é `value`, originado pelo intervalo [start, end) do texto corrido. */
const at = (doc: Doc, value: string, start: number, end: number): Field => ({ value, confidence: doc.confidence(start, end) })

// ---------------------------------------------------------------------------------------------------------------
// Datas

const MONTH_NAMES: Record<string, number> = {
  janeiro: 1, fevereiro: 2, marco: 3, março: 3, abril: 4, maio: 5, junho: 6, julho: 7, agosto: 8, setembro: 9,
  outubro: 10, novembro: 11, dezembro: 12, jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8,
  set: 9, sep: 9, out: 10, nov: 11, dez: 12,
}

function toISO(year: number, month: number, day: number): string | null {
  const fullYear = year < 100 ? 2000 + year : year
  if (fullYear < 1990 || fullYear > 2100 || month < 1 || month > 12 || day < 1) return null
  if (day > new Date(fullYear, month, 0).getDate()) return null
  const iso = `${fullYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  return isValidISODate(iso) ? iso : null
}

const NUMERIC_DATE = /(?<!\d)(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4}|\d{2})(?!\d)/g
const ISO_DATE = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g
const TEXT_DATE = /(?<!\d)(\d{1,2})\s*(?:de\s+|[-/.]\s*)?([A-Za-zÀ-ÿ]{3,9})\.?\s*(?:de\s+|[-/.,]\s*)?(\d{4}|\d{2})(?!\d)/gi

interface DateHit {
  iso: string
  start: number
  end: number
}

function datesIn(text: string, offset: number): DateHit[] {
  const hits: DateHit[] = []
  const push = (m: RegExpExecArray, iso: string | null) => {
    if (iso) hits.push({ iso, start: offset + m.index, end: offset + m.index + m[0].length })
  }
  for (const m of text.matchAll(NUMERIC_DATE)) push(m, toISO(Number(m[3]), Number(m[2]), Number(m[1])))
  for (const m of text.matchAll(ISO_DATE)) push(m, toISO(Number(m[1]), Number(m[2]), Number(m[3])))
  for (const m of text.matchAll(TEXT_DATE)) {
    const month = MONTH_NAMES[m[2]!.toLowerCase()]
    push(m, month ? toISO(Number(m[3]), month, Number(m[1])) : null)
  }
  return hits.sort((a, b) => a.start - b.start)
}

const NOT_ISSUE_DATE = /nascimento|nasc\b|v[áa]lid|validade|impress/i
const ISSUE_DATE_HINT = /data|emitid|emiss[ãa]o|colheita|realiza|exame|resultado|receita|luanda|lisboa|benguela|huambo|lubango|cabinda|malanje/i

function pickDate(doc: Doc, hint: RegExp): Field | undefined {
  const all: (DateHit & { line: string })[] = []
  for (const line of doc.lines) for (const hit of datesIn(line.text, line.start)) all.push({ ...hit, line: line.text })
  const usable = all.filter((d) => !NOT_ISSUE_DATE.test(d.line))
  const best = usable.find((d) => hint.test(d.line)) ?? usable[0]
  return best ? at(doc, best.iso, best.start, best.end) : undefined
}

// ---------------------------------------------------------------------------------------------------------------
// Médico, clínica/laboratório

const NAME_WORD = String.raw`\p{Lu}[\p{L}'’-]*\.?`
const TITLE = String.raw`(?:Dr\.?ª?|Dra|Doutor|Doutora)\.?`
const DOCTOR = new RegExp(
  String.raw`(?:\b(${TITLE})|M[ée]dic[oa](?:\s+(?:respons[áa]vel|assistente))?\s*[:\-]\s*(${TITLE})?)\s*(${NAME_WORD}(?:\s+(?:(?:d[aeo]s?|e)\s+)?${NAME_WORD}){0,4})`,
  'u',
)

function doctorFrom(line: string): { value: string; index: number; length: number } | undefined {
  const m = DOCTOR.exec(line)
  if (!m) return undefined
  const title = m[1] ?? m[2]
  const name = clean(m[3]!)
  if (name.length < 3 || /^(?:Dr|Dra)\.?$/u.test(name)) return undefined
  return { value: title ? `${title.replace(/\.?$/, '.')} ${name}` : name, index: m.index, length: m[0].length }
}

function findDoctor(doc: Doc): Field | undefined {
  for (const line of doc.lines) {
    const found = doctorFrom(line.text)
    if (found) return at(doc, found.value, line.start + found.index, line.start + found.index + found.length)
  }
  return undefined
}

const PLACE_WORDS = /cl[íi]nica|policl[íi]nica|centro\s+(?:de\s+sa[úu]de|m[ée]dico|hospitalar)|hospital|laborat[óo]rio|consult[óo]rio|instituto/i

function findPlace(doc: Doc): Field | undefined {
  for (const line of doc.lines) {
    if (!PLACE_WORDS.test(line.text) || /\bpaciente\b|\bdr\.?a?\b/i.test(line.text)) continue
    const label = /^\s*(?:cl[íi]nica|laborat[óo]rio|hospital|local|estabelecimento|unidade)\s*[:\-]\s*/i.exec(line.text)
    const from = label ? label[0].length : 0
    const value = clean(line.text.slice(from))
    if (value.length >= 4 && value.length <= 80) return at(doc, value, line.start + from, line.start + line.text.length)
  }
  return undefined
}

// ---------------------------------------------------------------------------------------------------------------
// Medicamentos

const DOSAGE_SOURCE = String.raw`(?<![\p{L}\d])(\d+(?:[.,]\d+)?)\s?(mg|mcg|µg|ug|g|ml|ui|meq|%)(?:\s?\/\s?\d*[.,]?\d*\s?(?:ml|mg|g|dose))?(?![\p{L}])`
const dosageRe = () => new RegExp(DOSAGE_SOURCE, 'iu')
const NUMBERING = /^\s*(?:\d{1,2}\s*[.)\-–]\s+|[-•*]\s+)/
const FORM_PREFIX = /^(?:tab|comp|c[áa]ps?|cap|xpe|xar|amp|sol|sup|pom|cr|xarope|pomada|gotas|comprimidos?|c[áa]psulas?|ampolas?)\.?\s+/i
const NOT_MEDICATION =
  /paciente|utente|nome\s*:|idade|sexo|morada|endere[çc]o|telefone|\btel\b|telem|\bbi\b|nif|(?<!\p{L})n[ºo°]\s*\d|assinatura|carimbo|\bdata\b|nascimento|m[ée]dic[oa]|^\s*dr\.?a?\b|doutor|cl[íi]nica|hospital|laborat[óo]rio|centro\s|receita|prescri[çc][ãa]o|^\s*rp\b|^\s*obs|validade|v[áa]lid|c[ée]dula|ordem\s+dos|rep[úu]blica|minist[ée]rio|\bkz\b/iu
const POSOLOGY =
  /comprimid|c[áa]psul|gotas|tomar|\btoma\b|horas|\bdias?\b|vez(?:es)?\b|durante|semana|\bdose\b|aplicar|xarope|ampola|saquet|\bsach|\bml\b|cont[ií]nu|refei|jejum|deitar|manh[ãa]|noite|\d\s*[x/]\s*\d|\d\s*id\b/i

const NUMBER_WORDS: [RegExp, number][] = [[/^uma?$/i, 1], [/^duas?$/i, 2], [/^tr[eê]s$/i, 3], [/^quatro$/i, 4]]

function parseFrequency(text: string): { index: number; length: number; value: DraftFrequency } | undefined {
  // «de 8 em 8 horas», «8/8h», «12 / 12 horas»
  let m = /(?:de\s+)?(\d{1,2})\s*(?:em|\/)\s*(\d{1,2})\s*(?:h\b|horas?|hrs?\b)/i.exec(text)
  if (m && m[1] === m[2]) {
    const hours = Number(m[1])
    return { index: m.index, length: m[0].length, value: { text: clean(m[0]), ...([4, 6, 8, 12, 24].includes(hours) ? { intervalHours: hours } : {}) } }
  }
  // «3 vezes por dia», «2x ao dia», «2x/dia»
  m = /(\d)\s*(?:x|vezes|v\.?)\s*(?:(?:ao|por|\/|em)\s*)?dia/i.exec(text)
  if (m) {
    const n = Number(m[1])
    return { index: m.index, length: m[0].length, value: { text: clean(m[0]), ...(n >= 1 && n <= 4 ? { perDay: n } : {}) } }
  }
  // «duas vezes por dia», «uma vez ao dia»
  m = /(uma|duas|tr[eê]s|quatro)\s+vez(?:es)?\s+(?:(?:ao|por)\s+)?dia/i.exec(text)
  if (m) {
    const perDay = NUMBER_WORDS.find(([re]) => re.test(m![1]!))?.[1]
    return { index: m.index, length: m[0].length, value: { text: clean(m[0]), ...(perDay ? { perDay } : {}) } }
  }
  m = /\b(?:diariamente|1\s*id|todos os dias|1\/dia)\b/i.exec(text)
  if (m) return { index: m.index, length: m[0].length, value: { text: clean(m[0]), perDay: 1 } }
  return undefined
}

function parseDuration(text: string): { index: number; length: number; value: { days?: number; continuous: boolean } } | undefined {
  let m = /\b(?:uso\s+cont[íi]nuo|cont[íi]nuo|cont[íi]nua|cr[óo]nico|sem\s+data\s+de\s+fim)\b/i.exec(text)
  if (m) return { index: m.index, length: m[0].length, value: { continuous: true } }
  m = /(?:durante|por|x)\s*(\d{1,3})\s*(dias?|semanas?|mes(?:es)?|m[êe]s)\b/i.exec(text)
  m ??= /(?<![\d/])(\d{1,3})\s*(dias?|semanas?)\b/i.exec(text)
  if (m) {
    const unit = m[2]!.toLowerCase()
    const days = Number(m[1]) * (unit.startsWith('sem') ? 7 : unit.startsWith('m') ? 30 : 1)
    if (days >= 1 && days <= 365) return { index: m.index, length: m[0].length, value: { days, continuous: false } }
  }
  return undefined
}

const MED_NOTES = /(?:antes|depois|ap[óo]s)\s+d?a?s?\s*refei[çc][õo]es|em\s+jejum|ao\s+deitar|com\s+[áa]gua|com\s+as\s+refei[çc][õo]es/i

interface MedBlock {
  parts: { text: string; start: number }[]
}

function medicationFromBlock(doc: Doc, block: MedBlock): DraftMedication | undefined {
  const first = block.parts[0]!
  const lead = NUMBERING.exec(first.text)?.[0].length ?? 0
  const firstText = first.text.slice(lead)
  const dosage = dosageRe().exec(firstText)
  let nameEnd = dosage ? dosage.index : firstText.length
  if (!dosage) {
    const stop = /\s[-–—:]\s|[:;,(]|\s(?:\d|comprimid|c[áa]ps|gotas|xarope|tomar)/i.exec(firstText)
    if (stop) nameEnd = stop.index
  }
  const rawName = firstText.slice(0, nameEnd)
  const prefix = FORM_PREFIX.exec(rawName)?.[0].length ?? 0
  const name = clean(rawName.slice(prefix))
  if (name.length < 2 || name.length > 60 || !/\p{L}{2}/u.test(name)) return undefined
  const base = first.start + lead
  const medication: DraftMedication = { name: at(doc, name, base + prefix, base + nameEnd) }
  if (dosage) medication.dosage = at(doc, clean(dosage[0]), base + dosage.index, base + dosage.index + dosage[0].length)
  for (const part of block.parts) {
    const text = part === first ? firstText : part.text
    const from = part === first ? base : part.start
    if (!medication.frequency) {
      const f = parseFrequency(text)
      if (f) medication.frequency = { value: f.value, confidence: doc.confidence(from + f.index, from + f.index + f.length) }
    }
    if (!medication.duration) {
      const d = parseDuration(text)
      if (d) medication.duration = { value: d.value, confidence: doc.confidence(from + d.index, from + d.index + d.length) }
    }
    if (!medication.notes) {
      const n = MED_NOTES.exec(text)
      if (n) medication.notes = at(doc, clean(n[0]), from + n.index, from + n.index + n[0].length)
    }
  }
  return medication
}

function findMedications(doc: Doc): DraftMedication[] {
  const blocks: MedBlock[] = []
  let current: MedBlock | null = null
  for (const line of doc.lines) {
    const text = line.text
    const numbered = NUMBERING.test(text)
    const body = text.replace(NUMBERING, '')
    const hasDosage = dosageRe().test(body)
    const ignored = NOT_MEDICATION.test(text) || (datesIn(text, 0).length > 0 && !hasDosage)
    if (!ignored && /^\s*\p{L}/u.test(body) && (hasDosage || (numbered && body.length >= 3 && !/^\s*(?:tomar|usar)/i.test(body)))) {
      current = { parts: [{ text, start: line.start }] }
      blocks.push(current)
    } else if (current && !ignored && POSOLOGY.test(text)) {
      current.parts.push({ text, start: line.start })
    } else if (ignored) {
      current = null
    }
  }
  return blocks.map((b) => medicationFromBlock(doc, b)).filter((m): m is DraftMedication => !!m)
}

function findNotes(doc: Doc): Field | undefined {
  for (const line of doc.lines) {
    const m = /^\s*obs(?:erva[çc][õo]es)?\.?\s*[:\-]\s*(.{3,200})$/i.exec(line.text)
    if (m) return at(doc, clean(m[1]!), line.start + line.text.length - m[1]!.length, line.start + line.text.length)
  }
  return undefined
}

/** Campos de uma receita: data de emissão, médico, clínica, medicamentos (nome, dosagem, frequência, duração) e observações. */
export function parsePrescription(lines: OcrLine[]): PrescriptionDraft {
  const doc = buildDoc(lines)
  const draft: PrescriptionDraft = { medications: findMedications(doc) }
  const issuedOn = pickDate(doc, ISSUE_DATE_HINT)
  const doctorName = findDoctor(doc)
  const clinicName = findPlace(doc)
  const notes = findNotes(doc)
  if (issuedOn) draft.issuedOn = issuedOn
  if (doctorName) draft.doctorName = doctorName
  if (clinicName) draft.clinicName = clinicName
  if (notes) draft.notes = notes
  return draft
}

// ---------------------------------------------------------------------------------------------------------------
// Exames

const EXAM_LABEL = /^\s*(?:tipo\s+de\s+exame|exame|an[áa]lise|pedido|designa[çc][ãa]o)\s*[:\-]\s*(.{3,80})$/i
const EXAM_TITLE = /(?:boletim|relat[óo]rio|laudo|resultados?)\s+(?:de|do|da)\s+(.{3,60})$/i
const EXAM_HEADING =
  /^\s*(an[áa]lises?\s+cl[íi]nicas?|hemograma(?:\s+completo)?|bioqu[íi]mica|urina\s+tipo\s+ii|ecografia[\p{L} ]*|radiografia[\p{L} ]*|eletrocardiograma|raio[- ]x[\p{L} ]*)\s*$/iu
const RESULT_HEADER = /^\s*(?:par[âa]metro|resultado|exame|an[áa]lise|determina[çc][ãa]o)\b/i
const NOT_RESULT =
  /paciente|utente|nome\s*:|idade|\bsexo|\bdata\b|m[ée]dic[oa]|requisi|colheita|laborat[óo]rio|cl[íi]nica|hospital|endere[çc]o|telefone|\btel\b|(?<!\p{L})n[ºo°]\s*\d|processo|amostra|^\s*obs|assinatura|nascimento|\bbi\b|nif|valida|respons[áa]vel|dire[ct]tor|p[áa]gina|biom[ée]dic|t[ée]cnic|^\s*dr\.?a?\b/iu

const TEXT_RESULT_SOURCE = String.raw`n[ãa]o\s+reagente|reagente|negativo|positivo|normal|anormal|ausentes?|presentes?|tra[çc]os|indetect[áa]vel|detect[áa]vel`
const UNIT = String.raw`%|\/[A-Za-zµμ][A-Za-zµμ0-9³²^]*|(?:10\^?\d+\/)?[A-Za-zµμ]+[A-Za-zµμ0-9³²^]*(?:\/[A-Za-zµμ0-9³²^.]+)*`
const NUM = String.raw`\d+(?:[.,]\d+)*`

const toNumber = (token: string) => Number(token.replace(',', '.'))

const RESULT_LINE = new RegExp(
  String.raw`^\s*(?<name>\p{L}[\p{L}0-9 .()\/%+,'-]{1,50}?)\s+(?<value>${NUM}|(?:${TEXT_RESULT_SOURCE}))(?:\s+(?<unit>${UNIT}))?(?<rest>\s+.*)?$`,
  'iu',
)

/** Uma linha de tabela: «Glicemia em jejum 98 mg/dL 70 - 99». */
function parseResultLine(doc: Doc, line: { text: string; start: number }): DraftResult | undefined {
  const text = line.text
  if (RESULT_HEADER.test(text) || NOT_RESULT.test(text) || datesIn(text, 0).length > 0) return undefined
  const g = RESULT_LINE.exec(text)?.groups
  if (!g) return undefined
  const name = clean(g.name!).replace(/[:.]+$/, '')
  if (name.length < 2 || !/\p{L}{2}/u.test(name)) return undefined
  const where = (part: string, from = 0) => line.start + text.indexOf(part, from)

  let value = g.value!
  const valueAt = where(value, name.length)
  let valueConfidence = doc.confidence(valueAt, valueAt + value.length)
  let unit = g.unit
  let rest = g.rest ?? ''
  // Um resultado em texto («Negativo») ou uma palavra longa não é unidade: passa para a referência.
  if (unit && (!/\d/.test(value) || /^[a-zà-ÿ]{5,}$/i.test(unit))) {
    rest = ` ${unit}${rest}`
    unit = undefined
  }
  // «6.800 /mm3» ou «6,800 /mm3»: separador de milhares; sem uma unidade «/…» é ambíguo (1.200 pode ser 1,2) ⇒ pede confirmação.
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(value)) {
    if (unit?.startsWith('/')) value = value.replace(/[.,]/g, '')
    else valueConfidence = Math.min(valueConfidence, CONFIDENCE_THRESHOLD - 0.01)
  }
  if (/\.\d+\.|,\d+,/.test(value)) return undefined

  const result: DraftResult = {
    parameter: at(doc, name, line.start, line.start + name.length),
    value: { value, confidence: valueConfidence },
  }
  if (unit) result.unit = at(doc, unit, where(unit, name.length), where(unit, name.length) + unit.length)

  const ref = rest.trim()
  if (ref) {
    const refAt = (found: string) => line.start + text.lastIndexOf(found)
    const conf = (found: string) => doc.confidence(refAt(found), refAt(found) + found.length)
    const range = new RegExp(String.raw`(${NUM})\s*(?:[-–—]|\ba\b|\bat[ée]\b)\s*(${NUM})`, 'i').exec(ref)
    const upper = new RegExp(String.raw`(?:^|\s)(?:[<≤]|at[ée]|inferior\s+a|menor\s+que)\s*(${NUM})`, 'i').exec(ref)
    const lower = new RegExp(String.raw`(?:^|\s)(?:[>≥]|superior\s+a|maior\s+que|acima\s+de)\s*(${NUM})`, 'i').exec(ref)
    const refText = new RegExp(String.raw`^[\p{P}\s]*(${TEXT_RESULT_SOURCE})`, 'iu').exec(ref)
    if (range && toNumber(range[1]!) <= toNumber(range[2]!)) {
      result.referenceMin = { value: range[1]!, confidence: conf(range[0]) }
      result.referenceMax = { value: range[2]!, confidence: conf(range[0]) }
    } else if (upper) {
      result.referenceMax = { value: upper[1]!, confidence: conf(upper[0].trim()) }
    } else if (lower) {
      result.referenceMin = { value: lower[1]!, confidence: conf(lower[0].trim()) }
    } else if (refText) {
      result.referenceText = { value: clean(refText[1]!), confidence: conf(refText[1]!) }
    }
  }
  return result
}

function findExamName(doc: Doc): Field | undefined {
  const tail = (line: { text: string; start: number }, value: string) =>
    at(doc, clean(value), line.start + line.text.length - value.length, line.start + line.text.length)
  for (const line of doc.lines) {
    const m = EXAM_LABEL.exec(line.text)
    if (m) return tail(line, m[1]!)
  }
  for (const line of doc.lines) {
    const m = EXAM_TITLE.exec(line.text)
    if (m && !NOT_RESULT.test(m[1]!)) return tail(line, m[1]!)
  }
  for (const line of doc.lines) {
    if (EXAM_HEADING.test(line.text)) return at(doc, clean(line.text), line.start, line.start + line.text.length)
  }
  return undefined
}

const EXAM_DATE_HINT = /colheita|realiza|exame|resultado|emiss|data/i
const MAX_RESULTS = 40

/** Campos de um laudo/boletim: tipo, data, laboratório e parâmetros (nome, valor, unidade, referência). */
export function parseExamination(lines: OcrLine[]): ExamDraft {
  const doc = buildDoc(lines)
  const results: DraftResult[] = []
  for (const line of doc.lines) {
    const result = parseResultLine(doc, line)
    if (result) results.push(result)
    if (results.length >= MAX_RESULTS) break
  }
  const draft: ExamDraft = { results }
  const name = findExamName(doc)
  const examDate = pickDate(doc, EXAM_DATE_HINT)
  const labName = findPlace(doc)
  if (name) draft.name = name
  if (examDate) draft.examDate = examDate
  if (labName) draft.labName = labName
  return draft
}
