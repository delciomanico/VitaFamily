/**
 * Leitura de texto no próprio dispositivo (Tesseract.js, WASM): a foto nunca é enviada a
 * ninguém, só os ficheiros públicos do motor/idioma são descarregados da CDN. Importado de
 * forma assíncrona para não pesar no pacote inicial de quem nunca usa esta função.
 */
let workerPromise: Promise<import('tesseract.js').Worker> | null = null

async function getWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker('por'))
  }
  return workerPromise
}

/** Texto reconhecido na imagem, em português; lança erro se a leitura falhar. */
export async function recognizeText(file: File): Promise<string> {
  const worker = await getWorker()
  const { data } = await worker.recognize(file)
  return data.text
}
