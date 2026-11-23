import { describe, expect, it } from 'vitest'
import { CONFIDENCE_THRESHOLD } from './ocrConfig'
import { hasUsefulFields, needsConfirmation, parseExamination, parsePrescription } from './ocrParse'
import { linesFromText, type OcrLine } from './ocrTypes'

// Amostras sintéticas (sem dados reais), em português de Angola e de Portugal. TC-OCR-01.
const RECEITA_AO = `
Clínica Sagrada Esperança
Luanda, 12 de março de 2026
Paciente: João Manuel Silva
Rp/
1. Amoxicilina 500 mg - 1 cápsula de 8 em 8 horas durante 7 dias
2) Paracetamol 1 g, 1 comprimido 2x ao dia por 5 dias, depois das refeições
Ibuprofeno 400mg 12/12h x 3 dias
Omeprazol 20 mg
  tomar uma vez ao dia em jejum, uso contínuo
Obs: beber bastante água
Dra. Ana Maria Costa
`

const RECEITA_PT = `
Centro de Saúde de Alvalade
Data: 03/11/2025
Utente: Maria Santos
Tab. Metformina 850 mg
Tomar 1 comprimido 3 vezes por dia, às refeições, durante 3 meses
Xarope Brufen 20 mg/ml
5 ml de 6 em 6 horas durante 5 dias
Médico: Dr. Pedro Nunes
`

const LAUDO = `
LABORATÓRIO DE ANÁLISES CLÍNICAS VIDA PLENA
Paciente: Maria João Pereira
Exame: Hemograma completo e bioquímica
Data da colheita: 05/03/2026
Parâmetro Resultado Unidade Valores de referência
Glicemia em jejum 98 mg/dL 70 - 99
Hemoglobina 13,5 g/dL 12,0 - 16,0
Colesterol total 210 mg/dL < 200
Leucócitos 6.800 /mm3 4.000 - 11.000
VS 12 mm/h Até 20
HIV Negativo Negativo
Responsável técnico: Dr. Carlos Mendes
`

const rx = (text: string, confidence = 0.95) => parsePrescription(linesFromText(text, confidence))
const ex = (text: string, confidence = 0.95) => parseExamination(linesFromText(text, confidence))

describe('receita (pt-AO)', () => {
  const draft = rx(RECEITA_AO)

  it('data, médico e clínica', () => {
    expect(draft.issuedOn?.value).toBe('2026-03-12')
    expect(draft.doctorName?.value).toBe('Dra. Ana Maria Costa')
    expect(draft.clinicName?.value).toBe('Clínica Sagrada Esperança')
    expect(draft.notes?.value).toBe('beber bastante água')
  })

  it('vários medicamentos com nome, dosagem, frequência e duração', () => {
    expect(draft.medications.map((m) => m.name.value)).toEqual(['Amoxicilina', 'Paracetamol', 'Ibuprofeno', 'Omeprazol'])
    const [amox, para, ibu, ome] = draft.medications
    expect(amox!.dosage?.value).toBe('500 mg')
    expect(amox!.frequency?.value).toMatchObject({ intervalHours: 8 })
    expect(amox!.duration?.value).toEqual({ days: 7, continuous: false })
    expect(para!.dosage?.value).toBe('1 g')
    expect(para!.frequency?.value).toMatchObject({ perDay: 2 })
    expect(para!.duration?.value.days).toBe(5)
    expect(para!.notes?.value).toMatch(/depois das refeições/i)
    expect(ibu!.dosage?.value).toBe('400mg')
    expect(ibu!.frequency?.value).toMatchObject({ intervalHours: 12 })
    expect(ibu!.duration?.value.days).toBe(3)
    // Posologia na linha seguinte.
    expect(ome!.dosage?.value).toBe('20 mg')
    expect(ome!.frequency?.value).toMatchObject({ perDay: 1 })
    expect(ome!.duration?.value.continuous).toBe(true)
    expect(ome!.notes?.value).toMatch(/jejum/i)
  })

  it('não confunde linhas do cabeçalho com medicamentos', () => {
    const names = draft.medications.map((m) => m.name.value.toLowerCase())
    expect(names.some((n) => /paciente|luanda|rp|dra|clínica/.test(n))).toBe(false)
  })
})

describe('receita (pt-PT)', () => {
  const draft = rx(RECEITA_PT)
  it('abreviaturas de forma, «vezes por dia», meses e doses por ml', () => {
    expect(draft.issuedOn?.value).toBe('2025-11-03')
    expect(draft.clinicName?.value).toBe('Centro de Saúde de Alvalade')
    expect(draft.doctorName?.value).toBe('Dr. Pedro Nunes')
    expect(draft.medications.map((m) => m.name.value)).toEqual(['Metformina', 'Brufen'])
    const [met, bru] = draft.medications
    expect(met!.dosage?.value).toBe('850 mg')
    expect(met!.frequency?.value).toMatchObject({ perDay: 3 })
    expect(met!.duration?.value.days).toBe(90)
    expect(bru!.dosage?.value).toBe('20 mg/ml')
    expect(bru!.frequency?.value).toMatchObject({ intervalHours: 6 })
    expect(bru!.duration?.value.days).toBe(5)
  })
})

describe('exame (laudo)', () => {
  const draft = ex(LAUDO)

  it('tipo, data e laboratório', () => {
    expect(draft.name?.value).toBe('Hemograma completo e bioquímica')
    expect(draft.examDate?.value).toBe('2026-03-05')
    expect(draft.labName?.value).toBe('LABORATÓRIO DE ANÁLISES CLÍNICAS VIDA PLENA')
  })

  it('parâmetros com valor, unidade e referência, copiados tal como estão', () => {
    expect(draft.results.map((r) => r.parameter.value)).toEqual([
      'Glicemia em jejum', 'Hemoglobina', 'Colesterol total', 'Leucócitos', 'VS', 'HIV',
    ])
    const by = Object.fromEntries(draft.results.map((r) => [r.parameter.value, r]))
    expect(by['Glicemia em jejum']).toMatchObject({
      value: { value: '98' }, unit: { value: 'mg/dL' }, referenceMin: { value: '70' }, referenceMax: { value: '99' },
    })
    expect(by.Hemoglobina!.value.value).toBe('13,5')
    expect(by.Hemoglobina!.referenceMin?.value).toBe('12,0')
    expect(by['Colesterol total']!.referenceMax?.value).toBe('200')
    expect(by['Colesterol total']!.referenceMin).toBeUndefined()
    // Ponto de milhares com unidade /mm3.
    expect(by['Leucócitos']!.value.value).toBe('6800')
    expect(by['Leucócitos']!.unit?.value).toBe('/mm3')
    expect(by.VS!.referenceMax?.value).toBe('20')
    expect(by.HIV).toMatchObject({ value: { value: 'Negativo' }, referenceText: { value: 'Negativo' } })
  })

  it('nunca interpreta: não há marcas de «fora da referência»', () => {
    expect(JSON.stringify(draft)).not.toMatch(/alto|baixo|fora|anormal/i)
  })
})

describe('campos ausentes e ilegíveis', () => {
  it('campo não encontrado fica ausente (nunca inventado)', () => {
    const draft = rx('Amoxicilina 500 mg')
    expect(draft.issuedOn).toBeUndefined()
    expect(draft.doctorName).toBeUndefined()
    expect(draft.clinicName).toBeUndefined()
    expect(draft.medications[0]!.frequency).toBeUndefined()
    expect(draft.medications[0]!.duration).toBeUndefined()
  })

  it('texto sem nada útil devolve rascunho vazio', () => {
    expect(hasUsefulFields(rx('xx ,, ~~ ///'))).toBe(false)
    expect(hasUsefulFields(ex('lorem ipsum dolor'))).toBe(false)
    expect(hasUsefulFields(rx(''))).toBe(false)
  })

  it('datas impossíveis ou de nascimento não são tomadas como data da receita', () => {
    expect(rx('Data de nascimento: 01/02/1980\nData: 31/02/2026').issuedOn).toBeUndefined()
    expect(rx('Data de nascimento: 01/02/1980\nEmitida em 05-06-26').issuedOn?.value).toBe('2026-06-05')
  })

  it('ponto de milhares sem unidade «/…» é ambíguo e pede confirmação', () => {
    const draft = ex('Ferritina 1.200 ng/mL 20 - 250')
    expect(needsConfirmation(draft.results[0]!.value.confidence)).toBe(true)
    expect(draft.results[0]!.value.value).toBe('1.200')
  })
})

describe('confiança por campo (BR-OCR-07)', () => {
  const word = (text: string, confidence: number) => ({ text, confidence })
  const lines: OcrLine[] = [
    { words: [word('Clínica', 0.95), word('Vida', 0.95)] },
    { words: [word('Amoxicilina', 0.55), word('500', 0.9), word('mg', 0.9)] },
    { words: [word('de', 0.9), word('8', 0.3), word('em', 0.9), word('8', 0.3), word('horas', 0.9)] },
  ]

  it('é a média das palavras que originaram o campo', () => {
    const med = parsePrescription(lines).medications[0]!
    expect(med.name.confidence).toBeCloseTo(0.55)
    expect(med.dosage!.confidence).toBeCloseTo(0.9)
    expect(med.frequency!.confidence).toBeCloseTo(0.66)
  })

  it('abaixo de 0,70 pede confirmação; alto não', () => {
    const med = parsePrescription(lines).medications[0]!
    expect(CONFIDENCE_THRESHOLD).toBe(0.7)
    expect(needsConfirmation(med.name.confidence)).toBe(true)
    expect(needsConfirmation(med.dosage!.confidence)).toBe(false)
    expect(needsConfirmation(0.7)).toBe(false)
    expect(needsConfirmation(0.699)).toBe(true)
  })
})
