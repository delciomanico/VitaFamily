import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { db, resetDb } from '@/mocks/db'
import * as orders from '@/mocks/handlers/examOrders'
import { at } from '@/mocks/time'
import { routes } from './router'

const DOCTOR = 'cac_horizonte_medica'
const MANAGER = 'cac_horizonte_rececao'
const ADMIN = 'cac_horizonte_admin'

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

const asClinic = (accountId: string) => window.sessionStorage.setItem('vf.clinic.session.accountId', accountId)
const asFamily = () => window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
const type = (label: string | RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } })

/** Consulta de hoje, já a decorrer, no horário da Dr.ª Ana (profissional da conta Médico). */
function ongoing(id = 'apt_xo', patch: Record<string, unknown> = {}) {
  db.slots.push({
    id: `slot_${id}`,
    clinicId: 'cln_horizonte',
    kind: 'APPOINTMENT',
    capacity: 1,
    specialty: 'Cardiologia',
    professionalId: 'pro_ana',
    professionalName: 'Dr.ª Ana Costa',
    startsAt: at(0, '10:00'),
    durationMinutes: 30,
  })
  db.appointments.push({
    id,
    familyId: 'fam_monarca',
    memberId: 'mem_maria',
    scheduledAt: new Date(Math.max(Date.now() - 30 * 60_000, new Date().setHours(0, 0, 1, 0))).toISOString(),
    status: 'SCHEDULED',
    slotId: `slot_${id}`,
    specialty: 'Cardiologia',
    clinicId: 'cln_horizonte',
    clinicName: 'Clínica Horizonte',
    ...patch,
  })
  return id
}

beforeEach(() => {
  resetDb()
  window.sessionStorage.clear()
  URL.createObjectURL = vi.fn(() => 'blob:pdf')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(window, 'open').mockReturnValue(null)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('pedido de exame: Médico (M15 U)', () => {
  it('pede exames no editor do relatório, vê a lista, imprime e cancela', async () => {
    const id = ongoing()
    asClinic(DOCTOR)
    renderAt(`/clinic/consultations/${id}/report`)
    expect(await screen.findByText('Sem pedidos de exame nesta consulta.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Pedir exames' }))
    // Texto livre por omissão (o catálogo é opcional).
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pedir exames' }))
    expect(await within(dialog).findByText('Indique pelo menos um exame.')).toBeInTheDocument()

    fireEvent.input(within(dialog).getByLabelText('Nome do exame'), { target: { value: 'Hemograma completo' } })
    fireEvent.input(within(dialog).getByLabelText('Nota (opcional)'), { target: { value: 'Jejum de 8 h' } })
    fireEvent.click(within(dialog).getByRole('switch', { name: 'Urgente' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Outro exame' }))
    expect(within(dialog).getByText('Exame 2')).toBeInTheDocument()
    fireEvent.input(within(dialog).getAllByLabelText('Nome do exame')[1]!, { target: { value: 'Glicemia' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pedir exames' }))

    expect(await screen.findByText('Pedido de exame criado.')).toBeInTheDocument()
    expect(await screen.findByText('Hemograma completo')).toBeInTheDocument()
    expect(screen.getByText('Jejum de 8 h')).toBeInTheDocument()
    expect(screen.getByText('Urgente')).toBeInTheDocument()
    expect(db.examOrders).toHaveLength(2)
    expect(db.examOrders[0]).toMatchObject({ urgent: true, note: 'Jejum de 8 h' })

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir pedido' }))
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('blob:pdf', '_blank', 'noopener,noreferrer'))

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancelar pedido' })[0]!)
    const confirm = await screen.findByRole('dialog', { name: 'Cancelar este pedido?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar pedido' }))
    expect(await screen.findByText('Pedido cancelado.')).toBeInTheDocument()
    expect(db.examOrders[0]!.cancelled).toBe(true)
    expect(await screen.findByText('Cancelado')).toBeInTheDocument()
  })

  it('concluir a consulta: secção recolhível "Pedir exames" cria os pedidos na mesma operação', async () => {
    const id = ongoing()
    asClinic(DOCTOR)
    renderAt('/clinic')
    fireEvent.click(await screen.findByRole('button', { name: 'Concluir' }))
    const toggle = await screen.findByRole('button', { name: 'Pedir exames (opcional)' })
    expect(screen.queryByLabelText('Nome do exame')).not.toBeInTheDocument()
    fireEvent.click(toggle)
    type('Nome do exame', 'ECG')
    fireEvent.click(screen.getByRole('button', { name: 'Concluir consulta' }))
    expect(await screen.findByText('Consulta concluída.')).toBeInTheDocument()
    expect(db.appointments.find((a) => a.id === id)?.status).toBe('COMPLETED')
    expect(db.examOrders).toHaveLength(1)
    expect(db.examOrders[0]).toMatchObject({ name: 'ECG', bookingId: id })
    expect(db.alerts.filter((a) => a.type === 'EXAM_ORDER_ADDED')).toHaveLength(1)
  })
})

describe('pedido de exame: Admin e Gestor só leem (BR-CLN-51)', () => {
  it.each([
    ['Gestor', MANAGER],
    ['Admin', ADMIN],
  ])('%s vê a lista e imprime, sem "Pedir exames" nem "Cancelar pedido"', async (_name, account) => {
    const id = ongoing()
    await orders.createClinicExamOrders(DOCTOR, id, [{ name: 'Hemograma' }])
    asClinic(account)
    renderAt(`/clinic/consultations/${id}/report`)
    expect(await screen.findByText('Hemograma')).toBeInTheDocument()
    expect(screen.getByText('Pedido')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Pedir exames' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancelar pedido' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir pedido' }))
    await waitFor(() => expect(window.open).toHaveBeenCalled())
  })

  it('o Gestor não vê "Pedir exames" ao concluir, nem no Hoje sem pedidos', async () => {
    ongoing()
    asClinic(MANAGER)
    renderAt('/clinic')
    await screen.findByRole('button', { name: 'Concluir' })
    expect(screen.queryByRole('button', { name: /Pedir exames|Pedidos de exame/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }))
    await screen.findByLabelText('Resultado da consulta')
    expect(screen.queryByRole('button', { name: 'Pedir exames (opcional)' })).not.toBeInTheDocument()
  })
})

describe('pedido de exame: catálogo de exames (M15 U)', () => {
  it.each([
    ['Médico', DOCTOR],
    ['Gestor', MANAGER],
    ['Admin', ADMIN],
  ])('%s vê o catálogo da clínica sem preços', async (_role, account) => {
    const options = await orders.listClinicExamServiceTypes(account)
    const exams = db.services.filter((s) => s.clinicId === 'cln_horizonte' && s.kind === 'EXAM' && s.active)
    expect(exams.length).toBeGreaterThan(0)
    expect(options.map((o) => o.id).sort()).toEqual(exams.map((s) => s.id).sort())
    for (const option of options) expect(Object.keys(option).sort()).toEqual(['durationMinutes', 'id', 'name'])
  })

  it('o Médico escolhe um exame do catálogo e envia serviceTypeId', async () => {
    const id = ongoing()
    const service = db.services.find((s) => s.clinicId === 'cln_horizonte' && s.kind === 'EXAM' && s.active)!
    asClinic(DOCTOR)
    renderAt(`/clinic/consultations/${id}/report`)
    fireEvent.click(await screen.findByRole('button', { name: 'Pedir exames' }))
    const dialog = await screen.findByRole('dialog')
    const select = await within(dialog).findByLabelText('Exame do catálogo')
    fireEvent.change(select, { target: { value: service.id } })
    expect(within(dialog).queryByLabelText('Nome do exame')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pedir exames' }))
    expect(await screen.findByText('Pedido de exame criado.')).toBeInTheDocument()
    expect(db.examOrders[0]).toMatchObject({ serviceTypeId: service.id, name: service.name })
  })
})

describe('pedido de exame: paciente Vita (M15 U)', () => {
  it('vê o cartão, marca o exame com o nome pré-preenchido e o pedido fica ligado', async () => {
    const id = ongoing('apt_xo', { status: 'COMPLETED' })
    await orders.createClinicExamOrders(DOCTOR, id, [{ name: 'Hemograma completo', note: 'Jejum', urgent: true }])
    asFamily()
    const router = renderAt(`/app/appointments/${id}`)
    expect(await screen.findByText('Exames pedidos')).toBeInTheDocument()
    expect(await screen.findByText('Hemograma completo')).toBeInTheDocument()
    expect(screen.getByText('Urgente')).toBeInTheDocument()
    expect(screen.getByText('Pedido')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('link', { name: 'Marcar este exame' }))
    expect(await screen.findByText(/A marcar o exame pedido pela clínica/)).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/app/health/examinations/new')
    expect(await screen.findByLabelText('Tipo de exame')).toHaveValue('Hemograma completo')
    expect(screen.getByLabelText(/Clínica\/Laboratório/)).toHaveValue('Clínica Horizonte')

    // Data futura: o exame fica agendado e liga-se ao pedido (ORDERED → SCHEDULED).
    const future = new Date()
    future.setDate(future.getDate() + 10)
    type('Data', future.toISOString().slice(0, 10))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar exame' }))
    await waitFor(() => expect(db.examOrders[0]!.examinationId).toBeDefined())
    expect(db.examinations.find((e) => e.id === db.examOrders[0]!.examinationId)).toMatchObject({ status: 'SCHEDULED', memberId: 'mem_maria' })

    cleanup()
    renderAt(`/app/appointments/${id}`)
    expect(await screen.findByText('Marcado')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Marcar este exame' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver o exame' })).toBeInTheDocument()
  })

  it('sem pedidos não há cartão; o alerta mostra texto genérico, sem o nome do exame', async () => {
    const id = ongoing('apt_xo', { status: 'COMPLETED' })
    asFamily()
    renderAt(`/app/appointments/${id}`)
    await screen.findByRole('heading', { name: 'Cardiologia' })
    expect(screen.queryByText('Exames pedidos')).not.toBeInTheDocument()

    await orders.createClinicExamOrders(DOCTOR, id, [{ name: 'Exame muito privado' }])
    cleanup()
    renderAt('/app/alerts')
    expect(await screen.findByText('Recebeu um novo pedido de exame de uma clínica.')).toBeInTheDocument()
    expect(screen.queryByText(/muito privado/)).not.toBeInTheDocument()
  })
})

describe('declaração de presença (M15 V)', () => {
  it('só aparece quando elegível (depois da chegada) e abre o PDF', async () => {
    ongoing()
    asClinic(MANAGER)
    renderAt('/clinic')
    fireEvent.click(await screen.findByRole('button', { name: 'Chegou' }))
    expect(await screen.findByText('Chegada registada.')).toBeInTheDocument()
    const issue = await screen.findByRole('button', { name: 'Declaração' })
    expect(screen.getByLabelText('Incluir o profissional')).not.toBeChecked()
    fireEvent.click(screen.getByLabelText('Incluir o profissional'))
    fireEvent.click(issue)
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('blob:pdf', '_blank', 'noopener,noreferrer'))
    expect(db.clinicAudit.some((e) => e.action === 'ATTENDANCE_STATEMENT_ISSUED')).toBe(true)
  })

  it('sem chegada não há botão', async () => {
    ongoing()
    asClinic(MANAGER)
    renderAt('/clinic')
    await screen.findByRole('button', { name: 'Chegou' })
    expect(screen.queryByRole('button', { name: 'Declaração' })).not.toBeInTheDocument()
  })

  it('concluída: o Médico também a emite', async () => {
    ongoing('apt_xo', { status: 'COMPLETED' })
    asClinic(DOCTOR)
    renderAt('/clinic/agenda')
    expect(await screen.findByRole('button', { name: 'Declaração' })).toBeInTheDocument()
  })
})

describe('ligações "Relatório" em falta (M15 S/U/V)', () => {
  it('ficha do paciente: consulta concluída mostra Relatório, Pedidos de exame e Declaração', async () => {
    const id = ongoing('apt_xo', { status: 'COMPLETED', memberId: 'mem_monarca' })
    await orders.createClinicExamOrders(DOCTOR, id, [{ name: 'Hemograma' }])
    asClinic(DOCTOR)
    renderAt('/clinic/patients/cpt_monarca')
    fireEvent.click(await screen.findByRole('tab', { name: 'Consultas e exames' }))
    expect(await screen.findByRole('link', { name: /Relatório/ })).toHaveAttribute('href', `/clinic/consultations/${id}/report`)
    expect(screen.getByRole('button', { name: 'Pedidos de exame (1)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Declaração' })).toBeInTheDocument()
  })

  it('calendário: a entrada da consulta tem as ações do relatório e da declaração', async () => {
    const id = ongoing('apt_xo', { status: 'COMPLETED' })
    asClinic(DOCTOR)
    renderAt('/clinic/agenda')
    expect(await screen.findByRole('button', { name: 'Declaração' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Relatório/ })).toHaveAttribute('href', `/clinic/consultations/${id}/report`)
  })
})

describe('relatório da consulta: autosave de 10 s (M15 S)', () => {
  it('guarda o rascunho 10 s depois da última alteração (debounce) e não antes', async () => {
    const id = ongoing()
    asClinic(DOCTOR)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAt(`/clinic/consultations/${id}/report`)
    await screen.findByLabelText('Motivo da consulta')

    type('Motivo da consulta', 'Dor lombar.')
    await act(() => vi.advanceTimersByTimeAsync(9_000))
    expect(db.consultationReports).toHaveLength(0)

    // Nova alteração reinicia a contagem dos 10 s.
    type('Achados', 'Sem défice.')
    await act(() => vi.advanceTimersByTimeAsync(9_000))
    expect(db.consultationReports).toHaveLength(0)

    await act(() => vi.advanceTimersByTimeAsync(1_500))
    expect(db.consultationReports).toHaveLength(1)
    expect(db.consultationReports[0]).toMatchObject({ status: 'DRAFT', reason: 'Dor lombar.', findings: 'Sem défice.' })
    expect(await screen.findByText(/^Guardado às \d\d:\d\d$/)).toBeInTheDocument()

    // Sem novas alterações não volta a guardar.
    const stamp = db.consultationReports[0]!.updatedAt
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    expect(db.consultationReports[0]!.updatedAt).toBe(stamp)
  })

  it('sem texto não há autosave', async () => {
    const id = ongoing()
    asClinic(DOCTOR)
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderAt(`/clinic/consultations/${id}/report`)
    await screen.findByLabelText('Motivo da consulta')
    type('Motivo da consulta', '   ')
    await act(() => vi.advanceTimersByTimeAsync(15_000))
    expect(db.consultationReports).toHaveLength(0)
  })
})
