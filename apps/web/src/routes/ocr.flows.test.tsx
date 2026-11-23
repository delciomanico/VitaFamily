import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { parseExamination, parsePrescription } from '@/lib/ocrParse'
import { linesFromText, type OcrLine } from '@/lib/ocrTypes'
import { readDocument } from '@/lib/ocrRun'
import { db, resetDb } from '@/mocks/db'
import { routes } from './router'

// O motor não corre no jsdom: a leitura é simulada com um resultado fixo (o parser é o verdadeiro).
vi.mock('@/lib/ocrRun', async (original) => ({ ...(await original<typeof import('@/lib/ocrRun')>()), readDocument: vi.fn() }))
const read = vi.mocked(readDocument)

const RECEITA = `Clínica Sagrada Esperança
Luanda, 12 de março de 2026
Paciente: João Silva
1. Amoxicilina 500 mg de 8 em 8 horas durante 7 dias
Dra. Ana Maria Costa`
const LAUDO = `Laboratório Vida Plena
Exame: Hemograma completo
Data da colheita: 05/03/2026
Glicemia 98 mg/dL 70 - 99
Hemoglobina 13,5 g/dL 12,0 - 16,0`

/** Texto com confiança alta, menos as palavras pedidas (confiança baixa ⇒ «Confirmar»). */
function lines(text: string, lowWords: string[] = []): OcrLine[] {
  return linesFromText(text, 0.95).map((line) => ({ words: line.words.map((w) => ({ ...w, confidence: lowWords.includes(w.text) ? 0.4 : w.confidence })) }))
}

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  render(
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>,
  )
  return router
}

const photo = () => new File([new Uint8Array(2048)], 'receita.jpg', { type: 'image/jpeg' })
const sheet = (name: string | RegExp) => screen.getByRole('dialog', { name })

async function takePhoto(file: File = photo()) {
  fireEvent.change(await screen.findByTestId('ocr-input-camera'), { target: { files: [file] } })
}

async function readyForm(name: string) {
  await screen.findByRole('button', { name: /Continuar|Guardar/ })
  return sheet(name)
}

const SAVE = (name: RegExp) => screen.getByRole('button', { name })

beforeEach(() => {
  cleanup()
  resetDb()
  read.mockReset()
  window.sessionStorage.clear()
  window.localStorage.clear()
  window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
})

describe('receita: fotografar primeiro (UC-OCR-01, AC-OCR-01, TC-OCR-04)', () => {
  it('a folha abre com câmara, galeria, PDF e «Preencher à mão», antes do formulário', async () => {
    renderAt('/app/health/prescriptions/new')
    await screen.findByRole('button', { name: 'Fotografar a receita' })
    const choose = sheet('Adicionar receita')
    for (const name of ['Fotografar a receita', 'Escolher da galeria', 'Escolher PDF', 'Preencher à mão']) {
      expect(within(choose).getByRole('button', { name })).toBeInTheDocument()
    }
    expect(within(choose).getByText(/não sai dele/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Data da receita')).not.toBeInTheDocument()
    expect(screen.getByTestId('ocr-input-camera')).toHaveAttribute('capture', 'environment')
    expect(screen.getByTestId('ocr-input-pdf')).toHaveAttribute('accept', 'application/pdf')
  })

  it('lê com progresso, mostra os campos com «Confirmar» onde falta confiança, pré-preenche e só guarda depois de confirmar', async () => {
    const before = db.prescriptions.length
    read.mockImplementation(async (_file, _kind, options) => {
      options?.onProgress?.({ stage: 'reading', percent: 55 })
      return { status: 'ok', draft: parsePrescription(lines(RECEITA, ['Amoxicilina'])), ignoredPages: 0, embedded: false } as never
    })
    renderAt('/app/health/prescriptions/new')
    await takePhoto()

    // Lista dos campos reconhecidos; só o medicamento mal lido leva «Confirmar» (ícone + texto, não só cor).
    const result = await screen.findByRole('dialog', { name: 'Encontrámos isto na receita' })
    expect(within(result).getByText('Dra. Ana Maria Costa')).toBeInTheDocument()
    expect(within(result).getAllByRole('button', { name: /^Confirmar/ })).toHaveLength(1)
    expect(within(result).getByRole('button', { name: 'Confirmar: Medicamento 1 · Nome' })).toHaveTextContent('Confirmar')
    fireEvent.click(within(result).getByRole('button', { name: 'Rever e guardar' }))

    // Formulário pré-preenchido, com a marca no campo e a ação de guardar bloqueada.
    let form = await readyForm('Adicionar receita')
    expect(within(form).getByLabelText('Data da receita')).toHaveValue('2026-03-12')
    expect(within(form).getByText(/Falta confirmar 1 campo assinalado/)).toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Continuar' }))
    expect(await within(form).findByLabelText('Nome')).toHaveValue('Amoxicilina')
    expect(within(form).getByLabelText('Dosagem')).toHaveValue('500 mg')
    expect(within(form).getByText('Pode estar mal lido')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-ocr-pending]')).toHaveLength(1)
    fireEvent.click(within(form).getByRole('button', { name: 'Continuar' }))
    // O original ficou anexado.
    expect(await within(form).findByText('receita.jpg')).toBeInTheDocument()
    expect(SAVE(/Guardar receita/)).toBeDisabled()
    expect(db.prescriptions.length).toBe(before) // nada guardado sem revisão (BR-OCR-08)

    // Volta ao medicamento, confirma, e já pode guardar.
    fireEvent.click(within(form).getByRole('button', { name: 'Voltar' }))
    fireEvent.click(await within(form).findByRole('button', { name: 'Confirmar' }))
    expect(within(form).queryByText('Pode estar mal lido')).not.toBeInTheDocument()
    form = sheet('Adicionar receita')
    expect(within(form).getByText('Tudo revisto. Pode guardar.')).toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Continuar' }))
    await waitFor(() => expect(SAVE(/Guardar receita/)).toBeEnabled())
    fireEvent.click(SAVE(/Guardar receita/))

    expect(await screen.findByText('Receita registada.')).toBeInTheDocument()
    expect(db.prescriptions.length).toBe(before + 1)
    const saved = db.prescriptions.at(-1)!
    expect(saved).toMatchObject({ doctorName: 'Dra. Ana Maria Costa', clinicName: 'Clínica Sagrada Esperança', issuedOn: '2026-03-12' })
    expect(db.documents.at(-1)).toMatchObject({ originalName: 'receita.jpg', resourceType: 'PRESCRIPTION' })
  })

  it('corrigir o campo assinalado também resolve a marca (sem tocar em «Confirmar»)', async () => {
    read.mockResolvedValue({ status: 'ok', draft: parsePrescription(lines(RECEITA, ['Amoxicilina'])), ignoredPages: 0, embedded: false } as never)
    renderAt('/app/health/prescriptions/new')
    await takePhoto()
    fireEvent.click(await screen.findByRole('button', { name: 'Rever e guardar' }))
    const form = await readyForm('Adicionar receita')
    fireEvent.click(within(form).getByRole('button', { name: 'Continuar' }))
    fireEvent.input(await within(form).findByLabelText('Nome'), { target: { value: 'Amoxicilina 500' } })
    await waitFor(() => expect(within(form).queryByText('Pode estar mal lido')).not.toBeInTheDocument())
    expect(within(form).getByText('Tudo revisto. Pode guardar.')).toBeInTheDocument()
  })

  it('«Confirmar» na lista de resultado resolve a marca antes do formulário', async () => {
    read.mockResolvedValue({ status: 'ok', draft: parsePrescription(lines(RECEITA, ['Amoxicilina'])), ignoredPages: 0, embedded: false } as never)
    renderAt('/app/health/prescriptions/new')
    await takePhoto()
    const result = await screen.findByRole('dialog', { name: 'Encontrámos isto na receita' })
    fireEvent.click(within(result).getByRole('button', { name: 'Confirmar: Medicamento 1 · Nome' }))
    expect(within(result).getByText('Confirmado')).toBeInTheDocument()
    fireEvent.click(within(result).getByRole('button', { name: 'Rever e guardar' }))
    const form = await readyForm('Adicionar receita')
    expect(within(form).getByText('Tudo revisto. Pode guardar.')).toBeInTheDocument()
  })

  it('campos de confiança alta vêm preenchidos sem marca nem alarido', async () => {
    read.mockResolvedValue({ status: 'ok', draft: parsePrescription(lines(RECEITA)), ignoredPages: 0, embedded: false } as never)
    renderAt('/app/health/prescriptions/new')
    await takePhoto()
    const result = await screen.findByRole('dialog', { name: 'Encontrámos isto na receita' })
    expect(within(result).queryByRole('button', { name: /^Confirmar/ })).not.toBeInTheDocument()
    fireEvent.click(within(result).getByRole('button', { name: 'Rever e guardar' }))
    const form = await readyForm('Adicionar receita')
    expect(document.querySelector('[data-ocr-pending]')).toBeNull()
    expect(within(form).getByText('Tudo revisto. Pode guardar.')).toBeInTheDocument()
  })

  it('«Cancelar» durante a leitura volta à escolha e nada fica guardado', async () => {
    let aborted = false
    read.mockImplementation((_file, _kind, options) => new Promise((resolve) => options?.signal?.addEventListener('abort', () => ((aborted = true), resolve({ status: 'failed', reason: 'cancelled' })))))
    renderAt('/app/health/prescriptions/new')
    await takePhoto()
    const reading = await screen.findByRole('dialog', { name: 'A ler a receita' })
    expect(within(reading).getByRole('progressbar')).toBeInTheDocument()
    expect(within(reading).getByText('A preparar a leitura (só na primeira vez).')).toBeInTheDocument()
    fireEvent.click(within(reading).getByRole('button', { name: 'Cancelar' }))
    expect(await screen.findByRole('button', { name: 'Fotografar a receita' })).toBeInTheDocument()
    expect(aborted).toBe(true)
  })

  it('«Preencher à mão» durante a leitura abre o formulário vazio com a foto ainda anexável', async () => {
    read.mockImplementation((_f, _k, options) => new Promise((resolve) => options?.signal?.addEventListener('abort', () => resolve({ status: 'failed', reason: 'cancelled' }))))
    renderAt('/app/health/prescriptions/new')
    await takePhoto()
    const reading = await screen.findByRole('dialog', { name: 'A ler a receita' })
    fireEvent.click(within(reading).getByRole('button', { name: 'Preencher à mão' }))
    const form = await readyForm('Adicionar receita')
    expect(within(form).queryByText(/Falta confirmar/)).not.toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Continuar' }))
    fireEvent.input(await within(form).findByLabelText('Nome'), { target: { value: 'Paracetamol' } })
    fireEvent.input(within(form).getByLabelText('Dosagem'), { target: { value: '1 g' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Continuar' }))
    expect(await within(form).findByText('receita.jpg')).toBeInTheDocument()
  })

  it.each([
    ['unreadable', /Não conseguimos ler bem esta imagem/],
    ['timeout', /A leitura demorou demasiado/],
    ['engine', /Não foi possível ler a foto neste aparelho/],
  ] as const)('falha graciosa (%s): mensagem simples, formulário manual, original anexado e registo possível (AC-OCR-05, TC-OCR-08)', async (reason, message) => {
    const before = db.prescriptions.length
    read.mockResolvedValue({ status: 'failed', reason })
    renderAt('/app/health/prescriptions/new')
    await takePhoto()
    const form = await readyForm('Adicionar receita')
    expect(within(form).getByText(message)).toBeInTheDocument()
    expect(within(form).queryByText(/Falta confirmar/)).not.toBeInTheDocument()
    expect(within(form).getByLabelText('Data da receita')).toBeInTheDocument()
    fireEvent.click(within(form).getByRole('button', { name: 'Continuar' }))
    fireEvent.input(await within(form).findByLabelText('Nome'), { target: { value: 'Paracetamol' } })
    fireEvent.input(within(form).getByLabelText('Dosagem'), { target: { value: '1 g' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Continuar' }))
    expect(await within(form).findByText('receita.jpg')).toBeInTheDocument()
    fireEvent.click(SAVE(/Guardar receita/))
    expect(await screen.findByText('Receita registada.')).toBeInTheDocument()
    expect(db.prescriptions.length).toBe(before + 1)
  })

  it('um ficheiro que não é foto nem PDF é recusado com uma frase simples', async () => {
    renderAt('/app/health/prescriptions/new')
    await takePhoto(new File(['x'], 'nota.txt', { type: 'text/plain' }))
    expect(await screen.findByText('Escolha uma foto (JPG ou PNG) ou um PDF.')).toBeInTheDocument()
    expect(read).not.toHaveBeenCalled()
  })

  it('«Preencher à mão» não lê nada', async () => {
    renderAt('/app/health/prescriptions/new')
    fireEvent.click(await screen.findByRole('button', { name: 'Preencher à mão' }))
    await readyForm('Adicionar receita')
    expect(read).not.toHaveBeenCalled()
  })

  it('a família não vê vocabulário técnico em nenhum passo', async () => {
    read.mockResolvedValue({ status: 'ok', draft: parsePrescription(lines(RECEITA, ['Amoxicilina'])), ignoredPages: 0, embedded: false } as never)
    renderAt('/app/health/prescriptions/new')
    await takePhoto()
    await screen.findByRole('dialog', { name: 'Encontrámos isto na receita' })
    expect(document.body.textContent).not.toMatch(/OCR|WASM|Tesseract|confian[çc]a|worker|0[,.]7/i)
  })
})

describe('exame: fotografar primeiro (UC-OCR-02, AC-OCR-02)', () => {
  it('pré-preenche tipo, data, laboratório e parâmetros; a linha mal lida leva «Confirmar» e o exame guarda-se com os resultados', async () => {
    const before = db.examinations.length
    read.mockResolvedValue({ status: 'ok', draft: parseExamination(lines(LAUDO, ['Hemoglobina'])), ignoredPages: 0, embedded: false } as never)
    renderAt('/app/health/examinations/new')
    await screen.findByRole('button', { name: 'Fotografar o resultado' })
    await takePhoto(new File([new Uint8Array(512)], 'laudo.jpg', { type: 'image/jpeg' }))

    const result = await screen.findByRole('dialog', { name: 'Encontrámos isto no resultado' })
    expect(within(result).getByText('Hemograma completo')).toBeInTheDocument()
    expect(within(result).getByText('Glicemia — 98 mg/dL (70–99)')).toBeInTheDocument()
    expect(within(result).getAllByRole('button', { name: /^Confirmar/ })).toHaveLength(1)
    fireEvent.click(within(result).getByRole('button', { name: 'Rever e guardar' }))

    const form = await readyForm('Adicionar exame')
    expect(within(form).getByLabelText('Tipo de exame')).toHaveValue('Hemograma completo')
    expect(within(form).getByLabelText('Data')).toHaveValue('2026-03-05')
    expect(within(form).getByLabelText(/Clínica\/Laboratório/)).toHaveValue('Laboratório Vida Plena')
    fireEvent.click(within(form).getByRole('button', { name: 'Continuar' }))
    expect(await within(form).findAllByLabelText('Parâmetro')).toHaveLength(2)
    expect(within(form).getAllByLabelText('Valor').map((i) => (i as HTMLInputElement).value)).toEqual(['98', '13,5'])
    expect(within(form).getAllByLabelText('Referência máx.').map((i) => (i as HTMLInputElement).value)).toEqual(['99', '16,0'])
    expect(within(form).getAllByText('Pode estar mal lido')).toHaveLength(1)
    fireEvent.click(within(form).getByRole('button', { name: 'Continuar' }))
    expect(await within(form).findByText('laudo.jpg')).toBeInTheDocument()
    expect(SAVE(/Guardar exame/)).toBeDisabled()

    fireEvent.click(within(form).getByRole('button', { name: 'Voltar' }))
    fireEvent.click(await within(form).findByRole('button', { name: 'Confirmar' }))
    fireEvent.click(within(form).getByRole('button', { name: 'Continuar' }))
    await waitFor(() => expect(SAVE(/Guardar exame/)).toBeEnabled())
    fireEvent.click(SAVE(/Guardar exame/))

    expect(await screen.findByText('Exame registado.')).toBeInTheDocument()
    expect(db.examinations.length).toBe(before + 1)
    expect(db.examinations.at(-1)).toMatchObject({ name: 'Hemograma completo', examDate: '2026-03-05', status: 'COMPLETED' })
    const saved = db.examinations.at(-1)!
    expect(db.examResults.filter((r) => r.examinationId === saved.id).map((r) => [r.parameter, r.valueNumeric, r.unit, r.referenceMax])).toEqual([['Glicemia', 98, 'mg/dL', 99], ['Hemoglobina', 13.5, 'g/dL', 16]])
    expect(db.documents.at(-1)).toMatchObject({ originalName: 'laudo.jpg', resourceType: 'EXAMINATION' })
  })

  it('o OCR não interpreta: nenhuma indicação de «alto», «baixo» ou «fora da referência» aparece', async () => {
    read.mockResolvedValue({ status: 'ok', draft: parseExamination(lines('Colesterol total 250 mg/dL < 200')), ignoredPages: 0, embedded: false } as never)
    renderAt('/app/health/examinations/new')
    await takePhoto()
    await screen.findByRole('dialog', { name: 'Encontrámos isto no resultado' })
    expect(document.body.textContent).not.toMatch(/alto|baixo|fora d|anormal|elevado/i)
  })

  it('o pedido de uma clínica a marcar segue direto para o formulário (sem fotografar)', async () => {
    renderAt('/app/health/examinations/new?examOrderId=ord_1&name=Hemograma')
    expect(await screen.findByText(/A marcar o exame pedido pela clínica/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fotografar o resultado' })).not.toBeInTheDocument()
  })
})
