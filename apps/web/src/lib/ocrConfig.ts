/**
 * Constantes do registo rápido por leitura de fotos (M16; BR-OCR-03/05/07; OP-142: PROPOSTA, a calibrar com
 * ensaios em dispositivo). Mudam aqui, num só sítio.
 */

/** Confiança (0–1) abaixo da qual o campo leva «Confirmar» (BR-OCR-07). */
export const CONFIDENCE_THRESHOLD = 0.7
/** Lado maior da cópia usada para ler, em píxeis (BR-OCR-03). */
export const OCR_MAX_SIDE = 2000
/** Páginas de PDF lidas; as restantes são ignoradas com aviso (BR-OCR-03). */
export const OCR_MAX_PDF_PAGES = 3
/** Limite duro da leitura: passado este tempo cai para o formulário manual (BR-OCR-05/10). */
export const OCR_HARD_TIMEOUT_MS = 30_000
/** Acima disto anexa-se uma versão reduzida em JPEG (BR-OCR-09, igual ao limite de BR-DOC-01). */
export const OCR_ATTACH_MAX_BYTES = 10 * 1024 * 1024

/**
 * Ficheiros do motor e do modelo: SEMPRE da própria origem (BR-OCR-02), nunca de uma CDN. São emitidos pelo
 * plugin `vite.ocr-assets.ts` e guardados em cache pelo service worker (funciona offline após o 1.º uso).
 */
export const OCR_ASSET_BASE = '/ocr'
export const OCR_ASSETS = {
  /** Worker do motor (a pasta do núcleo WASM escolhe a variante SIMD/relaxed-SIMD/simples por si). */
  workerPath: `${OCR_ASSET_BASE}/worker.min.js`,
  corePath: `${OCR_ASSET_BASE}/`,
  /** Pasta do modelo português (`por.traineddata.gz`, LSTM «best» inteiro). */
  langPath: OCR_ASSET_BASE,
} as const
