import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { db, resetDb } from '../db'
import * as portal from './clinicPortal'
import * as recs from './recommendations'

const NOW = new Date(2026, 9, 4, 12, 0)
const FAMILY = 'fam_monarca'
const MONARCA = 'usr_monarca'
const ADMIN = 'cac_horizonte_admin'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

/** Consulta confirmada na Clínica Horizonte. */
function appointment() {
  db.appointments.push({
    id: 'apt_rec',
    familyId: FAMILY,
    memberId: 'mem_monarca',
    scheduledAt: NOW.toISOString(),
    status: 'SCHEDULED',
    clinicId: 'cln_horizonte',
    clinicName: 'Clínica Horizonte',
  })
  return 'apt_rec'
}

beforeEach(() => resetDb(NOW))

describe('recomendações da clínica (BR-CLN-09)', () => {
  it('a clínica envia e o paciente lê, com o nome da clínica; é avisado sem o texto', async () => {
    const id = appointment()
    await portal.createClinicRecommendation(ADMIN, { appointmentId: id, text: '  Repouso 3 dias.  ' }, NOW)
    const [rec] = await recs.listRecommendations(FAMILY, MONARCA, 'mem_monarca', { appointmentId: id })
    expect(rec).toMatchObject({ text: 'Repouso 3 dias.', clinicName: 'Clínica Horizonte' })
    const alert = db.alerts.find((a) => a.type === 'RECOMMENDATION_ADDED')
    expect(alert).toBeDefined()
    expect(JSON.stringify(alert)).not.toContain('Repouso')
  })

  it('texto vazio, longo, sem origem ou com duas origens → VALIDATION_ERROR', async () => {
    const id = appointment()
    expect(await code(portal.createClinicRecommendation(ADMIN, { appointmentId: id, text: ' ' }, NOW))).toBe(
      'VALIDATION_ERROR',
    )
    expect(await code(portal.createClinicRecommendation(ADMIN, { appointmentId: id, text: 'x'.repeat(2001) }, NOW))).toBe(
      'VALIDATION_ERROR',
    )
    expect(
      await code(portal.createClinicRecommendation(ADMIN, { appointmentId: id, examinationId: 'e', text: 'ok' } as never, NOW)),
    ).toBe('VALIDATION_ERROR')
  })

  it('só em consultas da própria clínica; consulta cancelada → CONFLICT', async () => {
    const id = appointment()
    db.appointments.find((a) => a.id === id)!.clinicId = 'cln_vidaplena'
    expect(await code(portal.createClinicRecommendation(ADMIN, { appointmentId: id, text: 'ok' }, NOW))).toBe('NOT_FOUND')
    const own = appointment().replace('apt_rec', 'apt_rec')
    db.appointments.push({ ...db.appointments.find((a) => a.id === own)!, id: 'apt_canc', clinicId: 'cln_horizonte', status: 'CANCELLED' })
    expect(await code(portal.createClinicRecommendation(ADMIN, { appointmentId: 'apt_canc', text: 'ok' }, NOW))).toBe('CONFLICT')
  })

  it('a clínica só lista as suas', async () => {
    const id = appointment()
    await portal.createClinicRecommendation(ADMIN, { appointmentId: id, text: 'a' }, NOW)
    db.recommendations.push({ ...db.recommendations[0]!, id: 'rec_outra', clinicId: 'cln_vidaplena' })
    const list = await portal.listClinicRecommendations(ADMIN)
    expect(list.map((r) => r.id)).not.toContain('rec_outra')
    expect(list).toHaveLength(1)
  })
})
