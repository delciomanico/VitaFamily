import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * M16 (BR-OCR-02): o motor de leitura (worker + núcleo WASM) e o modelo `por` são servidos pela própria origem,
 * em `/ocr/…`, a partir dos pacotes npm (nada vem de uma CDN em tempo de execução). Em desenvolvimento servem-se
 * de `node_modules`; na compilação são emitidos para `dist/ocr/` (e guardados em cache pelo service worker).
 * Só se emitem as variantes «lstm» (modelo LSTM), que é o que o motor usa por omissão.
 */
const requireFromHere = createRequire(import.meta.url)

function packageDir(name: string, from = requireFromHere): string {
  return dirname(from.resolve(`${name}/package.json`))
}

function assetFiles(): Record<string, string> {
  const tesseractDir = packageDir('tesseract.js')
  const core = packageDir('tesseract.js-core', createRequire(join(tesseractDir, 'package.json')))
  const data = packageDir('@tesseract.js-data/por')
  return {
    'worker.min.js': join(tesseractDir, 'dist/worker.min.js'),
    'tesseract-core-lstm.wasm.js': join(core, 'tesseract-core-lstm.wasm.js'),
    'tesseract-core-simd-lstm.wasm.js': join(core, 'tesseract-core-simd-lstm.wasm.js'),
    'tesseract-core-relaxedsimd-lstm.wasm.js': join(core, 'tesseract-core-relaxedsimd-lstm.wasm.js'),
    'por.traineddata.gz': join(data, '4.0.0_best_int/por.traineddata.gz'),
  }
}

export function ocrAssets(): Plugin {
  const files = assetFiles()
  return {
    name: 'vita-ocr-assets',
    configureServer(server) {
      server.middlewares.use('/ocr', (req, res, next) => {
        const name = decodeURIComponent((req.url ?? '').split('?')[0]!.replace(/^\//, ''))
        const file = Object.hasOwn(files, name) ? files[name] : undefined
        if (!file) return next()
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        res.end(readFileSync(file))
      })
    },
    generateBundle() {
      for (const [name, file] of Object.entries(files)) {
        this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(file) })
      }
    },
  }
}
