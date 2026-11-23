import { describe, expect, it } from 'vitest'
import { exifOrientation, fitWithin, grayscaleContrast, orientationMatrix, orientedSize } from './ocrImage'

/** JPEG mínimo só com o cabeçalho EXIF (SOI + APP1) e a orientação pedida. */
function jpegWithOrientation(orientation: number, little: boolean): ArrayBuffer {
  const bytes = new Uint8Array(2 + 2 + 2 + 6 + 8 + 2 + 12 + 4)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0xffd8)
  view.setUint16(2, 0xffe1)
  view.setUint16(4, bytes.length - 4)
  view.setUint32(6, 0x45786966) // "Exif"
  const tiff = 12
  view.setUint16(tiff, little ? 0x4949 : 0x4d4d)
  view.setUint16(tiff + 2, 42, little)
  view.setUint32(tiff + 4, 8, little)
  view.setUint16(tiff + 8, 1, little) // 1 entrada
  view.setUint16(tiff + 10, 0x0112, little)
  view.setUint16(tiff + 12, 3, little)
  view.setUint32(tiff + 14, 1, little)
  view.setUint16(tiff + 18, orientation, little)
  return bytes.buffer
}

describe('orientação EXIF (BR-OCR-03, TC-OCR-03)', () => {
  it.each([1, 3, 6, 8])('lê a orientação %i em little e big endian', (orientation) => {
    expect(exifOrientation(jpegWithOrientation(orientation, true))).toBe(orientation)
    expect(exifOrientation(jpegWithOrientation(orientation, false))).toBe(orientation)
  })

  it('sem EXIF, truncado ou não-JPEG ⇒ 1 (sem rotação)', () => {
    expect(exifOrientation(new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer)).toBe(1)
    expect(exifOrientation(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)).toBe(1)
    expect(exifOrientation(jpegWithOrientation(6, true).slice(0, 20))).toBe(1)
    expect(exifOrientation(jpegWithOrientation(9, true))).toBe(1)
  })

  it('as orientações 5–8 trocam largura e altura; a matriz leva o canto certo à origem', () => {
    expect(orientedSize(400, 300, 1)).toEqual({ width: 400, height: 300 })
    expect(orientedSize(400, 300, 6)).toEqual({ width: 300, height: 400 })
    // 6 = rodar 90° no sentido horário: o ponto (0,0) do original vai para o canto superior direito (300,0).
    const [a, b, c, d, e, f] = orientationMatrix(6, 400, 300)
    expect([a * 0 + c * 0 + e, b * 0 + d * 0 + f]).toEqual([300, 0])
    // e o (400,0) vai para o canto inferior direito (300,400).
    expect([a * 400 + e, b * 400 + f]).toEqual([300, 400])
  })
})

describe('redução e cinzentos', () => {
  it('reduz o lado maior a ≤ 2000 px mantendo a proporção; nunca amplia', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(3000, 4000)).toEqual({ width: 1500, height: 2000 })
    expect(fitWithin(1200, 800)).toEqual({ width: 1200, height: 800 })
    expect(fitWithin(9000, 10)).toEqual({ width: 2000, height: 2 })
  })

  it('converte para cinzentos (R=G=B) e estica o contraste', () => {
    // 100 píxeis: metade cinzento-escuro (90), metade cinzento-claro (150), sem cor.
    const data = new Uint8ClampedArray(100 * 4)
    for (let i = 0; i < 100; i++) data.set(i < 50 ? [90, 90, 90, 255] : [150, 150, 150, 255], i * 4)
    grayscaleContrast(data)
    expect(data[0]).toBe(0)
    expect(data[99 * 4]).toBe(255)
    for (let i = 0; i < data.length; i += 4) expect(data[i]).toBe(data[i + 1])
    expect(data[3]).toBe(255) // alfa intacto
  })

  it('usa a luminância para cores e deixa imagens uniformes como estão', () => {
    const color = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255])
    grayscaleContrast(color)
    const [r, g, b] = [color[0]!, color[4]!, color[8]!]
    expect(g).toBeGreaterThan(r)
    expect(r).toBeGreaterThan(b)
    const flat = new Uint8ClampedArray([128, 128, 128, 255, 128, 128, 128, 255])
    grayscaleContrast(flat)
    expect([...flat]).toEqual([128, 128, 128, 255, 128, 128, 128, 255])
  })
})
