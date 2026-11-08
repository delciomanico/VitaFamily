/**
 * PDF simples para o backend simulado (M15): só texto, sem scripts, ligações nem formulários.
 * Com a API real o PDF vem do servidor; isto existe apenas para a demo/mock devolver um `Blob`.
 */

const PAGE_LINES = 52
const WRAP = 92

/** Escapa para uma string literal PDF em WinAnsi (latin1); o que não cabe vira "?". */
function pdfText(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63
    if (char === '\\' || char === '(' || char === ')') out += `\\${char}`
    else if (code >= 32 && code < 127) out += char
    else if (code >= 160 && code < 256) out += `\\${code.toString(8).padStart(3, '0')}`
    else out += code === 8212 || code === 8211 ? '-' : '?'
  }
  return out
}

function wrap(line: string): string[] {
  if (line.length <= WRAP) return [line]
  const out: string[] = []
  let current = ''
  for (const word of line.split(' ')) {
    if ((current + ' ' + word).trim().length > WRAP) {
      out.push(current)
      current = word
    } else current = (current + ' ' + word).trim()
  }
  if (current) out.push(current)
  return out
}

/** Gera um PDF A4 com as linhas dadas (quebra e paginação simples). */
export function buildTextPdf(lines: string[]): Blob {
  const wrapped = lines.flatMap((l) => l.split('\n')).flatMap(wrap)
  const pages: string[][] = []
  for (let i = 0; i < wrapped.length || i === 0; i += PAGE_LINES) pages.push(wrapped.slice(i, i + PAGE_LINES))

  const objects: string[] = []
  const pageIds = pages.map((_, i) => 4 + i * 2)
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  pages.forEach((pageLines, i) => {
    const content = `BT /F1 10 Tf 14 TL 50 800 Td ${pageLines.map((l) => `(${pdfText(l)}) '`).join(' ')} ET`
    objects[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`
    objects[5 + i * 2] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
  })

  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xref = body.length
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`
  for (let id = 1; id < objects.length; id += 1) body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  // Todos os bytes são ASCII (os acentos vão escapados), por isso o tamanho em caracteres é o dos bytes.
  return new Blob([body], { type: 'application/pdf' })
}

/** Abre um PDF (`Blob`) num separador novo, sem `opener`; liberta o URL pouco depois. */
export function openPdfInNewTab(blob: Blob): void {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
