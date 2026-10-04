import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { describeDuration, describeFrequency, intervalTimes, nextDoseAt } from '@/lib/medication'
import { db, resetDb } from '../db'
import * as meds from './medications'

/** Instante fixo: meio-dia local. */
const NOW = new Date(2026, 9, 4, 12, 0)
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

const prescriptionInput = (): meds.NewPrescriptionInput => ({
  memberId: 'mem_maria',
  issuedOn: '2026-10-04',
  doctorName: 'Dra. Teste',
  medications: [
    {
      name: 'Ibuprofeno',
      dosage: '400 mg',
      scheduleType: 'INTERVAL',
      intervalHours: 8,
      firstTime: '07:00',
      durationDays: 5,
      continuous: false,
    },
    { name: 'Omeprazol', dosage: '20 mg', scheduleType: 'FIXED_TIMES', times: ['20:00'], continuous: true },
  ],
  documents: [{ originalName: 'receita.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
})

beforeEach(() => resetDb(NOW))

describe('regras de horário', () => {
  it('de 8 em 8 horas a partir das 07:00 dá 07:00, 15:00 e 23:00', () => {
    expect(intervalTimes('07:00', 8)).toEqual(['07:00', '15:00', '23:00'])
  })

  it('próxima toma da Amoxicilina ao meio-dia é às 16:00', () => {
    const plan = db.medicationPlans.find((p) => p.id === 'med_amox')!
    expect(new Date(nextDoseAt(plan, NOW)!).getHours()).toBe(16)
    expect(describeFrequency(plan)).toBe('3 vezes por dia')
    expect(describeDuration(plan)).toBe('8 dias')
  })

  it('plano terminado não tem próxima toma', () => {
    const plan = db.medicationPlans.find((p) => p.id === 'med_vitd')!
    expect(nextDoseAt(plan, NOW)).toBeNull()
  })
})

describe('receitas', () => {
  it('lista as receitas visíveis com o número de medicamentos', async () => {
    const list = await meds.listPrescriptions(FAMILY, MONARCA)
    expect(list.map((r) => [r.prescription.id, r.medicationCount])).toEqual([
      ['rx_amox', 1],
      ['rx_joao', 2],
      ['rx_pedro', 1],
    ])
  })

  it('registar cria a receita ativa, um plano por medicamento, tomas futuras de hoje e o documento', async () => {
    const rx = await meds.createPrescription(FAMILY, MONARCA, prescriptionInput(), NOW)
    expect(rx.status).toBe('ACTIVE')
    const detail = await meds.getPrescription(FAMILY, MONARCA, rx.id)
    expect(detail.medications.map((m) => m.name)).toEqual(['Ibuprofeno', 'Omeprazol'])
    expect(detail.documents).toHaveLength(1)

    const ibuprofen = detail.medications[0]!
    const todayDoses = db.doses.filter((d) => d.planId === ibuprofen.id).map((d) => new Date(d.scheduledAt).getHours())
    // As 07:00 já passaram: só 15:00 e 23:00.
    expect(todayDoses).toEqual([15, 23])
    expect(describeDuration(ibuprofen)).toBe('5 dias')
  })

  it('recusa receita sem medicamentos, com data futura ou documento inválido', async () => {
    expect(await code(meds.createPrescription(FAMILY, MONARCA, { ...prescriptionInput(), medications: [] }, NOW))).toBe(
      'VALIDATION_ERROR',
    )
    expect(
      await code(meds.createPrescription(FAMILY, MONARCA, { ...prescriptionInput(), issuedOn: '2026-10-05' }, NOW)),
    ).toBe('VALIDATION_ERROR')
    const exe = { originalName: 'x.exe', mimeType: 'application/x-msdownload', sizeBytes: 10 }
    expect(
      await code(meds.createPrescription(FAMILY, MONARCA, { ...prescriptionInput(), documents: [exe] }, NOW)),
    ).toBe('VALIDATION_ERROR')
  })

  it('concluir termina os planos e remove só as tomas futuras pendentes', async () => {
    const before = db.doses.filter((d) => d.planId === 'med_amox')
    await meds.setPrescriptionStatus(FAMILY, MONARCA, 'rx_amox', 'COMPLETED', NOW)
    expect(db.medicationPlans.find((p) => p.id === 'med_amox')?.status).toBe('ENDED')
    const after = db.doses.filter((d) => d.planId === 'med_amox')
    // Fica a das 08:00 (histórico); saem as das 16:00 e 22:00.
    expect(before).toHaveLength(3)
    expect(after.map((d) => d.status)).toEqual(['TAKEN'])
  })
})

describe('medicamentos', () => {
  it('lista os medicamentos pela próxima toma, com estado dos lembretes', async () => {
    const list = await meds.listMedications(FAMILY, MONARCA, NOW)
    expect(list.map((m) => [m.plan.name, m.remindersOn])).toEqual([
      ['Amoxicilina', true],
      ['Metformina', true],
      ['Losartana', true],
      ['Vitamina D', false],
    ])
  })

  it('detalhe traz a receita associada', async () => {
    const detail = await meds.getMedication(FAMILY, MONARCA, 'med_metformina', NOW)
    expect(detail.prescription?.id).toBe('rx_joao')
    expect(detail.memberName).toBe('João Lopes')
  })

  it('editar os horários só muda as tomas futuras', async () => {
    await meds.updateMedication(
      FAMILY,
      MONARCA,
      'med_amox',
      {
        name: 'Amoxicilina',
        dosage: '500 mg',
        scheduleType: 'FIXED_TIMES',
        times: ['08:00', '18:00'],
        continuous: true,
      },
      NOW,
    )
    const hours = db.doses.filter((d) => d.planId === 'med_amox').map((d) => new Date(d.scheduledAt).getHours())
    expect(hours.sort((a, b) => a - b)).toEqual([8, 18])
  })

  it('desativar termina o plano e mantém o histórico', async () => {
    const plan = await meds.endMedication(FAMILY, MONARCA, 'med_metformina', NOW)
    expect(plan.status).toBe('ENDED')
    expect(db.doses.filter((d) => d.planId === 'med_metformina').map((d) => d.status)).toEqual(['UNCONFIRMED'])
  })

  it('sem acesso ao membro responde NOT_FOUND', async () => {
    expect(await code(meds.getMedication(FAMILY, 'usr_ninguem', 'med_amox', NOW))).toBe('NOT_FOUND')
    expect(await code(meds.getPrescription('fam_outra', MONARCA, 'rx_amox'))).toBe('NOT_FOUND')
  })
})
