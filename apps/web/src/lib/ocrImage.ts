import { OCR_MAX_SIDE } from './ocrConfig'

/*
 * Pré-processamento da imagem antes da leitura (BR-OCR-03): orientação EXIF, redução do lado maior a ≤ 2000 px,
 * escala de cinzentos e contraste. A cópia de leitura vive só em memória e é descartada no fim; a imagem anexada ao
 * registo é sempre o original (exceto se > 10 MB, caso em que se anexa uma versão reduzida em JPEG a cores).
 */

/** Orientação EXIF (1–8) de um JPEG; 1 (sem rotação) se não houver ou não for JPEG. */
export function exifOrientation(buffer: ArrayBuffer): number {
  const view = new DataView(buffer)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1
  let offset = 2
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset)
    if ((marker & 0xff00) !== 0xff00) return 1
    const size = view.getUint16(offset + 2)
    if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10
      const little = view.getUint16(tiff) === 0x4949
      const ifd = tiff + view.getUint32(tiff + 4, little)
      if (ifd + 2 > view.byteLength) return 1
      const entries = view.getUint16(ifd, little)
      const first = ifd + 2
      for (let i = 0; i < entries; i++) {
        const entry = first + i * 12
        if (entry + 12 > view.byteLength) return 1
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little)
          return value >= 1 && value <= 8 ? value : 1
        }
      }
      return 1
    }
    offset += 2 + size
  }
  return 1
}

/** Orientações 5–8 trocam largura e altura. */
export function orientedSize(width: number, height: number, orientation: number): { width: number; height: number } {
  return orientation >= 5 ? { width: height, height: width } : { width, height }
}

/** Matriz [a,b,c,d,e,f] que desenha a imagem em bruto, de `width`×`height`, na orientação correta. */
export function orientationMatrix(orientation: number, width: number, height: number): [number, number, number, number, number, number] {
  switch (orientation) {
    case 2: return [-1, 0, 0, 1, width, 0]
    case 3: return [-1, 0, 0, -1, width, height]
    case 4: return [1, 0, 0, -1, 0, height]
    case 5: return [0, 1, 1, 0, 0, 0]
    case 6: return [0, 1, -1, 0, height, 0]
    case 7: return [0, -1, -1, 0, height, width]
    case 8: return [0, -1, 1, 0, 0, width]
    default: return [1, 0, 0, 1, 0, 0]
  }
}

/** Tamanho final: o lado maior fica em `maxSide` no máximo (nunca amplia). */
export function fitWithin(width: number, height: number, maxSide = OCR_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Escala de cinzentos (luminância) e esticar o contraste entre os percentis 1 % e 99 %; altera `data` (RGBA) no lugar. */
export function grayscaleContrast(data: Uint8ClampedArray): void {
  const histogram = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    const gray = Math.round(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!)
    data[i] = data[i + 1] = data[i + 2] = gray
    histogram[gray]!++
  }
  const total = data.length / 4
  let low = 0
  let high = 255
  for (let sum = 0; low < 255 && (sum += histogram[low]!) < total * 0.01; low++);
  for (let sum = 0; high > 0 && (sum += histogram[high]!) < total * 0.01; high--);
  if (high - low < 16) return // quase uniforme: esticar só ampliaria ruído
  const scale = 255 / (high - low)
  for (let i = 0; i < data.length; i += 4) {
    const stretched = Math.max(0, Math.min(255, Math.round((data[i]! - low) * scale)))
    data[i] = data[i + 1] = data[i + 2] = stretched
  }
}

type Canvas = HTMLCanvasElement

function newCanvas(width: number, height: number): Canvas {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

interface Decoded {
  source: CanvasImageSource
  width: number
  height: number
  orientation: number
  close(): void
}

/** Descodifica aplicando nós a orientação EXIF (o browser não a aplica quando `imageOrientation: 'none'`). */
async function decode(file: Blob): Promise<Decoded> {
  const orientation = file.type === 'image/jpeg' ? exifOrientation(await file.arrayBuffer()) : 1
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'none' })
    return { source: bitmap, width: bitmap.width, height: bitmap.height, orientation, close: () => bitmap.close() }
  }
  // Sem createImageBitmap: o <img> já aplica o EXIF por si.
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, orientation: 1, close: () => {} }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function drawOriented(decoded: Decoded, maxSide: number): Canvas {
  const oriented = orientedSize(decoded.width, decoded.height, decoded.orientation)
  const target = fitWithin(oriented.width, oriented.height, maxSide)
  const canvas = newCanvas(target.width, target.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const [a, b, c, d, e, f] = orientationMatrix(decoded.orientation, decoded.width, decoded.height)
  const k = target.width / oriented.width
  ctx.setTransform(a * k, b * k, c * k, d * k, e * k, f * k)
  ctx.drawImage(decoded.source, 0, 0)
  return canvas
}

/** Cópia só para leitura: orientada, ≤ 2000 px, cinzentos e contraste. */
export async function preprocessImage(file: Blob, maxSide = OCR_MAX_SIDE): Promise<Canvas> {
  const decoded = await decode(file)
  try {
    const canvas = drawOriented(decoded, maxSide)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
    grayscaleContrast(pixels.data)
    ctx.putImageData(pixels, 0, 0)
    return canvas
  } finally {
    decoded.close()
  }
}

/** Versão reduzida em JPEG, a cores e orientada, para anexar quando o original passa o limite (BR-OCR-09). */
export async function reduceForAttachment(file: File, maxSide = OCR_MAX_SIDE): Promise<File> {
  const decoded = await decode(file)
  try {
    const canvas = drawOriented(decoded, maxSide)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    if (!blob) throw new Error('jpeg')
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' })
  } finally {
    decoded.close()
  }
}

/**
 * Imagem que o browser abre mas que o registo não aceita (ex.: HEIC) passa a JPEG; null se não abrir.
 * JPG, PNG e PDF seguem como estão.
 */
export async function acceptableOriginal(file: File): Promise<File | null> {
  if (['image/jpeg', 'image/png', 'application/pdf'].includes(file.type)) return file
  if (!file.type.startsWith('image/') && !/\.(heic|heif)$/i.test(file.name)) return null
  try {
    return await reduceForAttachment(file, 4000)
  } catch {
    return null
  }
}
