import { describe, expect, it, vi } from 'vitest'
import { OCR_ASSETS } from './ocrConfig'

const createWorker = vi.fn()
vi.mock('tesseract.js', () => ({ createWorker: (...args: unknown[]) => createWorker(...args), PSM: { AUTO: '3' } }))

describe('motor de leitura: só a própria origem (BR-OCR-02, TC-OCR-02)', () => {
  it('todos os caminhos do motor e do modelo são da própria origem, sem CDN', async () => {
    const { engineOptions } = await import('./ocr')
    const options = engineOptions()
    for (const key of ['workerPath', 'corePath', 'langPath'] as const) {
      expect(options[key], key).toMatch(/^\/ocr(\/|$)/)
      expect(options[key]).not.toMatch(/^[a-z]+:|^\/\//i)
    }
    expect(options.workerBlobURL).toBe(false)
    expect(JSON.stringify(OCR_ASSETS)).not.toMatch(/https?:|jsdelivr|unpkg|cdn/i)
  })

  it('o worker é criado com esses caminhos (nunca os da CDN por omissão)', async () => {
    createWorker.mockResolvedValue({ setParameters: vi.fn(), terminate: vi.fn(), recognize: vi.fn() })
    const { createEngine } = await import('./ocr')
    await createEngine()
    const [lang, oem, options] = createWorker.mock.calls[0]!
    expect(lang).toBe('por')
    expect(oem).toBe(1)
    expect(options).toMatchObject({ workerPath: '/ocr/worker.min.js', corePath: '/ocr/', langPath: '/ocr' })
  })

  it('converte blocos do motor em linhas com confiança 0–1 e ignora palavras vazias', async () => {
    const word = (text: string, confidence: number) => ({ text, confidence })
    const recognize = vi.fn().mockResolvedValue({
      data: { blocks: [{ paragraphs: [{ lines: [{ words: [word('Glicemia', 96), word(' ', 10), word('98', 54)] }, { words: [word(' ', 0)] }] }] }] },
    })
    createWorker.mockResolvedValue({ setParameters: vi.fn(), terminate: vi.fn(), recognize })
    const { createEngine } = await import('./ocr')
    const engine = await createEngine()
    expect(await engine.recognize(new Blob(['x']))).toEqual([
      { words: [{ text: 'Glicemia', confidence: 0.96 }, { text: '98', confidence: 0.54 }] },
    ])
  })
})

describe('sem CDN no código de leitura (BR-OCR-02)', () => {
  it('nenhum ficheiro de leitura nem componente do M16 referencia um endereço externo', () => {
    const files = import.meta.glob(['./ocr*.ts', '../components/ocr/*.tsx', '../../vite.ocr-assets.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    expect(Object.keys(files).length).toBeGreaterThan(6)
    for (const [name, source] of Object.entries(files)) {
      if (name.endsWith('.test.ts')) continue
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(code, name).not.toMatch(/https?:\/\/|jsdelivr|unpkg|cdnjs/i)
    }
  })
})
