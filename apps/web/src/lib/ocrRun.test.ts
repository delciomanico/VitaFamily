import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OcrEngine } from './ocr'
import type { PdfContent } from './ocrPdf'
import { readDocument, type ReadDeps, type ReadProgress } from './ocrRun'
import { linesFromText } from './ocrTypes'

const RECEITA = `Clínica Vida Plena
Data: 12/03/2026
Amoxicilina 500 mg
de 8 em 8 horas durante 7 dias
Dra. Ana Costa`

const canvas = () => ({ width: 10, height: 10 }) as HTMLCanvasElement
const image = () => new File(['x'], 'receita.jpg', { type: 'image/jpeg' })
const pdfFile = () => new File(['x'], 'receita.pdf', { type: 'application/pdf' })

function engineOf(overrides: Partial<OcrEngine> = {}): OcrEngine & { terminate: ReturnType<typeof vi.fn>; recognize: ReturnType<typeof vi.fn> } {
  return {
    recognize: vi.fn(async (_c, onProgress?: (f: number) => void) => {
      onProgress?.(0.5)
      onProgress?.(1)
      return linesFromText(RECEITA, 0.9)
    }),
    terminate: vi.fn(async () => {}),
    ...overrides,
  } as never
}

function depsOf(engine: OcrEngine, over: Partial<ReadDeps> = {}): ReadDeps {
  return {
    createEngine: async () => engine,
    preprocess: async () => canvas(),
    openPdf: async () => {
      throw new Error('sem PDF')
    },
    timeoutMs: 30_000,
    ...over,
  }
}

function pdfOf(over: Partial<PdfContent> = {}): PdfContent {
  return { pageCount: 1, embeddedText: null, renderPage: vi.fn(async () => canvas()), close: vi.fn(async () => {}), ...over }
}

afterEach(() => vi.useRealTimers())

describe('readDocument', () => {
  it('lê, extrai os campos e mostra as etapas «A preparar», «A ler», «A preencher» com percentagem crescente', async () => {
    const engine = engineOf()
    const steps: ReadProgress[] = []
    const result = await readDocument(image(), 'PRESCRIPTION', { deps: depsOf(engine), onProgress: (p) => steps.push(p) })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.draft).toMatchObject({ doctorName: { value: 'Dra. Ana Costa' }, issuedOn: { value: '2026-03-12' } })
    expect(result.draft.medications[0]!.name.value).toBe('Amoxicilina')
    expect([...new Set(steps.map((s) => s.stage))]).toEqual(['preparing', 'reading', 'filling'])
    const percents = steps.map((s) => s.percent)
    expect([...percents].sort((a, b) => a - b)).toEqual(percents)
    expect(percents.at(-1)).toBe(100)
    expect(engine.terminate).toHaveBeenCalledOnce() // o worker é sempre libertado
  })

  it('cancelar interrompe a leitura, liberta o motor e não devolve campos', async () => {
    const controller = new AbortController()
    const engine = engineOf({ recognize: vi.fn(() => new Promise(() => {})) as never })
    const run = readDocument(image(), 'PRESCRIPTION', {
      deps: depsOf(engine),
      signal: controller.signal,
      onProgress: (p) => p.stage === 'reading' && controller.abort(),
    })
    expect(await run).toEqual({ status: 'failed', reason: 'cancelled' })
    expect(engine.terminate).toHaveBeenCalled()
  })

  it('já cancelado antes de começar ⇒ cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    expect(await readDocument(image(), 'PRESCRIPTION', { deps: depsOf(engineOf()), signal: controller.signal })).toEqual({ status: 'failed', reason: 'cancelled' })
  })

  it('limite duro de 30 s ⇒ falha graciosa «timeout» e motor libertado (TC-OCR-06)', async () => {
    vi.useFakeTimers()
    const engine = engineOf({ recognize: vi.fn(() => new Promise(() => {})) as never })
    const run = readDocument(image(), 'PRESCRIPTION', { deps: depsOf(engine) })
    await vi.advanceTimersByTimeAsync(29_999)
    let settled = false
    void run.then(() => (settled = true))
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await run).toEqual({ status: 'failed', reason: 'timeout' })
    expect(engine.terminate).toHaveBeenCalled()
  })

  it('erro do motor (ex.: sem WASM) ⇒ falha graciosa «engine», sem expor a mensagem do erro', async () => {
    const result = await readDocument(image(), 'PRESCRIPTION', {
      deps: depsOf(engineOf(), { createEngine: async () => Promise.reject(new Error('Amoxicilina 500 mg segredo')) }),
    })
    expect(result).toEqual({ status: 'failed', reason: 'engine' })
    expect(JSON.stringify(result)).not.toMatch(/Amoxicilina|segredo/)
  })

  it('erro a ler a imagem ⇒ «engine»; erro a abrir a imagem ⇒ «unreadable»', async () => {
    const broken = engineOf({ recognize: vi.fn(async () => Promise.reject(new Error('x'))) as never })
    expect(await readDocument(image(), 'PRESCRIPTION', { deps: depsOf(broken) })).toEqual({ status: 'failed', reason: 'engine' })
    const result = await readDocument(image(), 'PRESCRIPTION', { deps: depsOf(engineOf(), { preprocess: async () => Promise.reject(new Error('x')) }) })
    expect(result).toEqual({ status: 'failed', reason: 'unreadable' })
  })

  it('texto ilegível ou sem campos úteis ⇒ «unreadable» (BR-OCR-10)', async () => {
    const engine = engineOf({ recognize: vi.fn(async () => linesFromText('~~ ,, xx', 0.2)) as never })
    expect(await readDocument(image(), 'PRESCRIPTION', { deps: depsOf(engine) })).toEqual({ status: 'failed', reason: 'unreadable' })
  })

  it('o exame usa o extrator de exames', async () => {
    const engine = engineOf({ recognize: vi.fn(async () => linesFromText('Laboratório Vida\nExame: Hemograma\nGlicemia 98 mg/dL 70 - 99', 0.9)) as never })
    const result = await readDocument(image(), 'EXAMINATION', { deps: depsOf(engine) })
    expect(result.status === 'ok' && result.draft.results[0]!.parameter.value).toBe('Glicemia')
  })

  it('PDF com texto embutido ⇒ sem OCR de imagem (o motor nem é criado)', async () => {
    const createEngine = vi.fn(async () => engineOf())
    const pdf = pdfOf({ embeddedText: linesFromText(RECEITA) })
    const result = await readDocument(pdfFile(), 'PRESCRIPTION', { deps: depsOf(engineOf(), { createEngine, openPdf: async () => pdf }) })
    expect(result.status === 'ok' && result.embedded).toBe(true)
    expect(createEngine).not.toHaveBeenCalled()
    expect(pdf.renderPage).not.toHaveBeenCalled()
    expect(pdf.close).toHaveBeenCalled()
  })

  it('PDF digitalizado de 5 páginas ⇒ lê só 3 e avisa que 2 foram ignoradas (TC-OCR-03)', async () => {
    const engine = engineOf()
    const pdf = pdfOf({ pageCount: 5 })
    const result = await readDocument(pdfFile(), 'PRESCRIPTION', { deps: depsOf(engine, { openPdf: async () => pdf }) })
    expect(pdf.renderPage).toHaveBeenCalledTimes(3)
    expect(engine.recognize).toHaveBeenCalledTimes(3)
    expect(result.status === 'ok' && result.ignoredPages).toBe(2)
  })
})
