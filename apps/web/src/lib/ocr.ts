/**
 * Motor de leitura no próprio dispositivo (Tesseract.js, WASM, num Web Worker): a foto nunca é enviada a ninguém e
 * o motor e o modelo vêm da própria origem (BR-OCR-02; `ocrConfig.ts`). Importado de forma assíncrona para não pesar
 * no pacote inicial de quem nunca usa esta função. Nada do texto reconhecido é registado (BR-OCR-12).
 */
import { OCR_ASSETS } from './ocrConfig'
import type { OcrLine } from './ocrTypes'

export interface OcrEngine {
  /** Lê uma imagem; `onProgress` recebe 0–1 só da fase de leitura. */
  recognize(image: Blob | HTMLCanvasElement | OffscreenCanvas, onProgress?: (fraction: number) => void): Promise<OcrLine[]>
  /** Liberta o worker (cancelamento, tempo excedido ou fim). */
  terminate(): Promise<void>
}

/** Opções do motor: todos os caminhos relativos à própria origem. */
export function engineOptions() {
  const { workerPath, corePath, langPath } = OCR_ASSETS
  return { workerPath, corePath, langPath, gzip: true, workerBlobURL: false } as const
}

export async function createEngine(onPrepared?: (fraction: number) => void): Promise<OcrEngine> {
  const { createWorker, PSM } = await import('tesseract.js')
  let current: ((fraction: number) => void) | undefined
  const worker = await createWorker('por', 1, {
    ...engineOptions(),
    logger: (message) => {
      if (message.status === 'recognizing text') current?.(message.progress)
      else onPrepared?.(message.progress)
    },
    errorHandler: () => {},
  })
  await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' })
  return {
    async recognize(image, onProgress) {
      current = onProgress
      const { data } = await worker.recognize(image, {}, { blocks: true })
      current = undefined
      const lines: OcrLine[] = []
      for (const block of data.blocks ?? [])
        for (const paragraph of block.paragraphs)
          for (const line of paragraph.lines)
            lines.push({
              words: line.words
                .filter((word) => word.text.trim().length > 0)
                .map((word) => ({ text: word.text.trim(), confidence: Math.min(1, Math.max(0, word.confidence / 100)) })),
            })
      return lines.filter((line) => line.words.length > 0)
    },
    async terminate() {
      await worker.terminate()
    },
  }
}
