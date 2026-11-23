import { OCR_ASSETS, OCR_MAX_PDF_PAGES, OCR_MAX_SIDE } from './ocrConfig'
import { linesFromText, type OcrLine } from './ocrTypes'

/*
 * PDF (BR-OCR-03): usa o texto embutido, se existir (sem OCR de imagem); senão rasteriza até 3 páginas para ler.
 * O pdf.js carrega-se à parte (só quem escolhe um PDF o descarrega) e o seu worker vem da própria origem.
 */

/** Menos palavras do que isto numa página ⇒ trata-se de um digitalizado (sem texto útil). */
const MIN_EMBEDDED_WORDS = 15

export interface PdfContent {
  pageCount: number
  /** Linhas do texto embutido das páginas lidas, ou null se o PDF é um digitalizado. */
  embeddedText: OcrLine[] | null
  /** Rasteriza a página `index` (a partir de 0) para ler, com o lado maior ≤ 2000 px. */
  renderPage(index: number): Promise<HTMLCanvasElement>
  close(): Promise<void>
}

export async function openPdf(file: Blob): Promise<PdfContent> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  pdfjs.GlobalWorkerOptions.workerSrc = OCR_ASSETS.pdfWorkerPath
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  const pages = Math.min(doc.numPages, OCR_MAX_PDF_PAGES)

  const lines: OcrLine[] = []
  let words = 0
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    // Cada item do pdf.js é um troço de texto; `hasEOL` marca o fim da linha.
    let current = ''
    for (const item of content.items) {
      if (!('str' in item)) continue
      current += item.str
      if (item.hasEOL) {
        lines.push(...linesFromText(current))
        current = ''
      }
    }
    if (current) lines.push(...linesFromText(current))
    words = lines.reduce((sum, line) => sum + line.words.length, 0)
  }

  return {
    pageCount: doc.numPages,
    embeddedText: words >= MIN_EMBEDDED_WORDS * pages ? lines : null,
    async renderPage(index) {
      const page = await doc.getPage(index + 1)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: Math.min(3, OCR_MAX_SIDE / Math.max(base.width, base.height)) })
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(viewport.width)
      canvas.height = Math.round(viewport.height)
      await page.render({ canvas, viewport }).promise
      return canvas
    },
    close: () => task.destroy(),
  }
}
