import { OCR_HARD_TIMEOUT_MS, OCR_MAX_PDF_PAGES } from './ocrConfig'
import { hasUsefulFields, parseExamination, parsePrescription, type ExamDraft, type PrescriptionDraft } from './ocrParse'
import type { OcrLine } from './ocrTypes'
import type { OcrEngine } from './ocr'
import type { PdfContent } from './ocrPdf'

/*
 * Orquestra a leitura de um documento (UC-OCR-01..03): pré-processa, lê (num Web Worker), extrai os campos e
 * devolve um rascunho para rever. Etapas com percentagem (BR-OCR-04), cancelável, limite duro de 30 s (BR-OCR-05) e
 * falha graciosa (BR-OCR-10). Nada do texto reconhecido sai daqui nem é registado (BR-OCR-12): os erros são
 * traduzidos em motivos fixos, sem conteúdo.
 */

export type ReadKind = 'PRESCRIPTION' | 'EXAMINATION'
export type ReadStage = 'preparing' | 'reading' | 'filling'
export type FailReason = 'timeout' | 'cancelled' | 'unreadable' | 'engine'

export interface ReadProgress {
  stage: ReadStage
  /** 0–100 do conjunto. */
  percent: number
}

export type ReadResult<D> =
  | { status: 'ok'; draft: D; /** páginas de PDF ignoradas (> 3) */ ignoredPages: number; /** texto embutido de PDF, sem OCR */ embedded: boolean }
  | { status: 'failed'; reason: FailReason }

/** Dependências, injetáveis nos testes (o motor e o canvas não existem no jsdom). */
export interface ReadDeps {
  createEngine(): Promise<OcrEngine>
  preprocess(file: Blob): Promise<HTMLCanvasElement>
  openPdf(file: Blob): Promise<PdfContent>
  /** Para os testes de tempo. */
  timeoutMs: number
}

async function defaultDeps(): Promise<ReadDeps> {
  const [{ createEngine }, { preprocessImage }, { openPdf }] = await Promise.all([import('./ocr'), import('./ocrImage'), import('./ocrPdf')])
  return { createEngine: () => createEngine(), preprocess: (file) => preprocessImage(file), openPdf, timeoutMs: OCR_HARD_TIMEOUT_MS }
}

export interface ReadOptions {
  signal?: AbortSignal
  onProgress?: (progress: ReadProgress) => void
  deps?: ReadDeps
}

class Stop extends Error {
  constructor(readonly reason: FailReason) {
    super(reason)
  }
}

// Repartição da percentagem: preparar 0–20, ler 20–90, preencher 90–100.
const PREPARE_END = 20
const READ_END = 90

export function readDocument(file: File, kind: 'PRESCRIPTION', options?: ReadOptions): Promise<ReadResult<PrescriptionDraft>>
export function readDocument(file: File, kind: 'EXAMINATION', options?: ReadOptions): Promise<ReadResult<ExamDraft>>
export function readDocument(file: File, kind: ReadKind, options?: ReadOptions): Promise<ReadResult<PrescriptionDraft | ExamDraft>>
export async function readDocument(file: File, kind: ReadKind, options: ReadOptions = {}): Promise<ReadResult<PrescriptionDraft | ExamDraft>> {
  const deps = options.deps ?? (await defaultDeps())
  const { signal, onProgress } = options
  const report = (stage: ReadStage, percent: number) => onProgress?.({ stage, percent: Math.round(Math.min(100, Math.max(0, percent))) })

  let engine: OcrEngine | null = null
  let finished = false
  let failure: FailReason = 'unreadable'
  let pdf: PdfContent | null = null
  let stoppedWith: FailReason | null = null
  let stop!: (reason: FailReason) => void
  const stopped = new Promise<never>((_, reject) => {
    stop = (reason) => {
      stoppedWith ??= reason
      reject(new Stop(reason))
    }
  })
  stopped.catch(() => {})
  const timer = setTimeout(() => stop('timeout'), deps.timeoutMs)
  const onAbort = () => stop('cancelled')
  if (signal?.aborted) onAbort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const guard = <T>(work: Promise<T>): Promise<T> => (stoppedWith ? stopped.then(() => work) : Promise.race([work, stopped]))

  try {
    report('preparing', 0)
    let lines: OcrLine[] = []
    let ignoredPages = 0
    let embedded = false

    if (file.type === 'application/pdf') {
      pdf = await guard(deps.openPdf(file))
      ignoredPages = Math.max(0, pdf.pageCount - OCR_MAX_PDF_PAGES)
      if (pdf.embeddedText) {
        embedded = true
        lines = pdf.embeddedText
      } else {
        const pages = Math.min(pdf.pageCount, OCR_MAX_PDF_PAGES)
        const readPage = await prepareEngine()
        for (let i = 0; i < pages; i++) {
          const canvas = await guard(pdf.renderPage(i))
          lines.push(...(await readPage(canvas, i, pages)))
        }
      }
    } else {
      const readPage = await prepareEngine()
      const canvas = await guard(deps.preprocess(file))
      lines = await readPage(canvas, 0, 1)
    }

    if (stoppedWith) throw new Stop(stoppedWith)
    report('filling', READ_END)
    const draft = kind === 'PRESCRIPTION' ? parsePrescription(lines) : parseExamination(lines)
    if (!hasUsefulFields(draft)) return { status: 'failed', reason: 'unreadable' }
    report('filling', 100)
    return { status: 'ok', draft, ignoredPages, embedded }

    /** Cria o motor e devolve a função que lê uma página (progresso 20–90 repartido pelas páginas). */
    async function prepareEngine() {
      const created = deps.createEngine()
      // Se parar antes de o motor existir, liberta-o assim que chegar.
      created.then((e) => {
        if (finished) void e.terminate()
      }, () => {})
      failure = 'engine'
      engine = await guard(created)
      failure = 'unreadable'
      report('preparing', PREPARE_END)
      return async (canvas: HTMLCanvasElement, index: number, total: number) => {
        const span = (READ_END - PREPARE_END) / total
        const from = PREPARE_END + span * index
        report('reading', from)
        failure = 'engine'
        const result = await guard(engine!.recognize(canvas, (fraction) => report('reading', from + span * fraction)))
        failure = 'unreadable'
        canvas.width = canvas.height = 0 // liberta a memória da cópia de leitura
        return result
      }
    }
  } catch (error) {
    if (error instanceof Stop) return { status: 'failed', reason: error.reason }
    return { status: 'failed', reason: failure }
  } finally {
    finished = true
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    const current = engine as OcrEngine | null
    await Promise.allSettled([current?.terminate(), pdf?.close()])
  }
}
