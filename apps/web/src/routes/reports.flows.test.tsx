import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportTemplateFor } from '@/config/reportTemplates'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { db, resetDb } from '@/mocks/db'
import * as portal from '@/mocks/handlers/clinicPortal'
import * as reports from '@/mocks/handlers/clinicReports'
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
function ongoing(id = 'apt_rel') {
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
  vi.restoreAllMocks()
})

describe('textos-guia estáticos', () => {
  it('por especialidade (sem acentos) e modelo geral por omissão; são só placeholders', () => {
    expect(reportTemplateFor('Cardiologia').reason).toMatch(/palpita/)
    expect(reportTemplateFor('PEDIATRIA').findings).toMatch(/peso/)
    expect(reportTemplateFor('Medicina dentária')).toEqual(reportTemplateFor(undefined))
  })
})

describe('relatório da consulta: Médico (M15 S)', () => {
  it('escreve com contadores, guarda rascunho, finaliza e acrescenta adenda', async () => {
    const id = ongoing()
    asClinic(DOCTOR)
    renderAt(`/clinic/consultations/${id}/report`)
    await screen.findByRole('heading', { name: 'Relatório da consulta' })

    const reason = await screen.findByLabelText('Motivo da consulta')
    // O texto-guia é só placeholder: o campo começa vazio e o contador mostra o limite do contrato.
    expect(reason).toHaveValue('')
    expect(reason).toHaveAttribute('placeholder', expect.stringMatching(/palpita/))
    expect(reason).toHaveAccessibleDescription('0/300 caracteres')
    expect(screen.getByLabelText('Conduta / plano')).toHaveAccessibleDescription('0/1500 caracteres')

    // Sem texto não se guarda.
    fireEvent.click(screen.getByRole('button', { name: 'Guardar rascunho' }))
    expect(await screen.findByText('Escreva pelo menos uma secção.')).toBeInTheDocument()

    type('Motivo da consulta', 'Dor lombar.')
    expect(screen.getByLabelText('Motivo da consulta')).toHaveAccessibleDescription('11/300 caracteres')
    type('Diagnóstico / impressão', 'Lombalgia mecânica.')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar rascunho' }))
    expect(await screen.findByText('Rascunho guardado.')).toBeInTheDocument()
    expect(db.consultationReports[0]).toMatchObject({ status: 'DRAFT', reason: 'Dor lombar.' })
    expect(await screen.findByText(/^Guardado às \d\d:\d\d$/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Finalizar relatório' }))
    expect(await screen.findByText('Depois de finalizar só pode acrescentar adendas.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finalizar' }))
    expect(await screen.findByText('Relatório finalizado.')).toBeInTheDocument()
    expect(db.consultationReports[0]).toMatchObject({ status: 'FINAL', impression: 'Lombalgia mecânica.' })
    // FINAL: texto bloqueado (sem campos), PDF e adenda.
    expect(screen.queryByLabelText('Motivo da consulta')).not.toBeInTheDocument()
    expect(screen.getByText('Dor lombar.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Acrescentar adenda' }))
    fireEvent.input(await screen.findByLabelText('Texto da adenda'), { target: { value: 'Exame recebido: normal.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar adenda' }))
    expect(await screen.findByText('Adenda guardada.')).toBeInTheDocument()
    expect(within(screen.getByRole('list', { name: 'Adendas' })).getByText('Exame recebido: normal.')).toBeInTheDocument()
    expect(db.consultationReports[0]!.addenda).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Imprimir / PDF' }))
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('blob:pdf', '_blank', 'noopener,noreferrer'))
  })

  it('concluir a consulta: secção recolhível e um só botão que passa a "Concluir e finalizar"', async () => {
    const id = ongoing()
    asClinic(DOCTOR)
    renderAt('/clinic')
    fireEvent.click(await screen.findByRole('button', { name: 'Concluir' }))
    const toggle = await screen.findByRole('button', { name: 'Relatório da consulta (opcional)' })
    expect(screen.queryByLabelText('Achados')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Concluir consulta' })).toBeInTheDocument()

    fireEvent.click(toggle)
    type('Achados', 'Sem alterações.')
    expect(screen.queryByRole('button', { name: 'Concluir consulta' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Concluir e finalizar' }))

    expect(await screen.findByText('Consulta concluída.')).toBeInTheDocument()
    expect(db.appointments.find((a) => a.id === id)?.status).toBe('COMPLETED')
    expect(db.consultationReports[0]).toMatchObject({ status: 'FINAL', findings: 'Sem alterações.', sharedWithPatient: true })
  })

  it('concluir sem tocar no relatório não cria nenhum', async () => {
    ongoing()
    asClinic(DOCTOR)
    renderAt('/clinic')
    fireEvent.click(await screen.findByRole('button', { name: 'Concluir' }))
    fireEvent.input(await screen.findByLabelText('Resultado da consulta'), { target: { value: 'Tudo bem.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Concluir consulta' }))
    expect(await screen.findByText('Consulta concluída.')).toBeInTheDocument()
    expect(db.consultationReports).toHaveLength(0)
  })
})

describe('relatório da consulta: Admin e Gestor só leem (BR-CLN-44)', () => {
  it('Gestor vê o relatório em leitura, com PDF, sem campos nem adenda', async () => {
    const id = ongoing()
    await reports.saveClinicConsultationReport(DOCTOR, id, { reason: 'Palpitações.', plan: 'Holter.' })
    await reports.finalizeClinicConsultationReport(DOCTOR, id)
    asClinic(MANAGER)
    renderAt(`/clinic/consultations/${id}/report`)
    expect(await screen.findByText('Palpitações.')).toBeInTheDocument()
    expect(screen.getByText('Final')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Acrescentar adenda' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Finalizar relatório' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Imprimir / PDF' }))
    await waitFor(() => expect(window.open).toHaveBeenCalled())
  })

  it('Admin sem relatório vê um estado vazio (nunca o editor); e o Hoje não oferece "Relatório" ao Gestor', async () => {
    const id = ongoing()
    asClinic(ADMIN)
    renderAt(`/clinic/consultations/${id}/report`)
    expect(await screen.findByText('Esta consulta ainda não tem relatório.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Motivo da consulta')).not.toBeInTheDocument()

    cleanup()
    asClinic(MANAGER)
    renderAt('/clinic')
    await screen.findByRole('button', { name: 'Concluir' })
    expect(screen.queryByRole('link', { name: /^(Ver relatório|Relatório( \(.*\))?)$/ })).not.toBeInTheDocument()
  })

  it('Gestor a concluir não vê a secção de relatório', async () => {
    ongoing()
    asClinic(MANAGER)
    renderAt('/clinic')
    fireEvent.click(await screen.findByRole('button', { name: 'Concluir' }))
    await screen.findByLabelText('Resultado da consulta')
    expect(screen.queryByRole('button', { name: /Relatório da consulta/ })).not.toBeInTheDocument()
  })

  it('o Médico vê a ligação "Relatório" nas suas consultas em curso', async () => {
    ongoing()
    asClinic(DOCTOR)
    renderAt('/clinic')
    expect(await screen.findByRole('link', { name: 'Relatório' })).toHaveAttribute('href', expect.stringMatching(/\/report$/))
  })
})

describe('relatório da consulta: paciente (BR-CLN-45)', () => {
  it('vê o cartão e o relatório (com adendas e PDF) só quando FINAL e partilhado', async () => {
    const id = ongoing()
    await reports.saveClinicConsultationReport(DOCTOR, id, { reason: 'Palpitações.', impression: 'Ansiedade.' })
    asFamily()
    renderAt(`/app/appointments/${id}`)
    await screen.findByRole('heading', { name: 'Cardiologia' })
    expect(screen.queryByText('Relatório da consulta')).not.toBeInTheDocument() // rascunho: nada

    await reports.finalizeClinicConsultationReport(DOCTOR, id)
    await reports.addClinicConsultationReportAddendum(DOCTOR, id, 'Resultado normal.')
    cleanup()
    const router = renderAt(`/app/appointments/${id}`)
    fireEvent.click(await screen.findByRole('link', { name: /Ver o relatório da clínica/ }))
    expect(await screen.findByText('Ansiedade.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/app/appointments/${id}/report`)
    expect(screen.getByText('Resultado normal.')).toBeInTheDocument()
    expect(screen.getByText(/Documento não fiscal/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Descarregar PDF' }))
    await waitFor(() => expect(window.open).toHaveBeenCalled())
  })

  it('relatório não partilhado: sem cartão e a página diz que não há relatório', async () => {
    const id = ongoing()
    await reports.saveClinicConsultationReport(DOCTOR, id, { reason: 'Privado.', sharedWithPatient: false })
    await reports.finalizeClinicConsultationReport(DOCTOR, id)
    asFamily()
    renderAt(`/app/appointments/${id}`)
    await screen.findByRole('heading', { name: 'Cardiologia' })
    expect(screen.queryByRole('link', { name: /Ver o relatório/ })).not.toBeInTheDocument()
    cleanup()
    renderAt(`/app/appointments/${id}/report`)
    expect(await screen.findByText('Esta consulta não tem relatório disponível.')).toBeInTheDocument()
    expect(screen.queryByText('Privado.')).not.toBeInTheDocument()
  })
})

describe('exames: rascunho e laudo (M15 T)', () => {
  async function pendingExam() {
    const [slot] = await portal.publishClinicSlots(ADMIN, {
      kind: 'EXAM',
      capacity: 1,
      date: '2026-12-01',
      times: ['09:00'],
      specialty: 'Análises',
      durationMinutes: 30,
    })
    const exam = {
      id: 'exm_laudo',
      familyId: 'fam_monarca',
      memberId: 'mem_maria',
      name: 'Análises',
      examDate: '2026-12-01',
      status: 'SCHEDULED' as const,
      clinicId: 'cln_horizonte',
      clinicName: 'Clínica Horizonte',
      slotId: slot!.id,
    }
    db.examinations.push(exam)
    return exam.id
  }

  it('guarda rascunho, reabre com ele, conclui com laudo e o paciente vê "Laudo da clínica"; sem realce na UI', async () => {
    const id = await pendingExam()
    asClinic(ADMIN)
    renderAt(`/clinic/exams/${id}/results`)
    await screen.findByRole('heading', { name: 'Resultados do exame' })
    expect(await screen.findByRole('switch', { name: 'Gerar laudo em PDF' })).toBeChecked()

    type('Parâmetro 1', 'Hemoglobina')
    type('Valor 1', '11,2')
    type('Unidade 1', 'g/dL')
    type('Referência mín. 1', '12')
    type('Referência máx. 1', '16')
    fireEvent.click(screen.getByRole('button', { name: 'Guardar rascunho' }))
    expect(await screen.findByText('Rascunho guardado.')).toBeInTheDocument()
    expect(db.examResultDrafts).toHaveLength(1)
    expect(db.examResults.filter((r) => r.examinationId === id)).toHaveLength(0)

    // Reabrir carrega o rascunho.
    cleanup()
    renderAt(`/clinic/exams/${id}/results`)
    expect(await screen.findByLabelText('Parâmetro 1')).toHaveValue('Hemoglobina')
    expect(screen.getByLabelText('Valor 1')).toHaveValue('11.2')
    // Valor abaixo da referência (11,2 < 12): o editor não assinala nada; só a nota estática.
    expect(screen.getAllByText(/Fora da referência/)).toHaveLength(1)
    expect(screen.getByText(/não é interpretação clínica/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Concluir exame' }))
    expect(await screen.findByText('Resultados emitidos.')).toBeInTheDocument()
    expect(db.examResultDrafts).toHaveLength(0)
    expect(db.documents.some((d) => d.resourceId === id && d.generatedBySystem)).toBe(true)
    expect(await screen.findByRole('button', { name: 'Laudo (PDF)' })).toBeInTheDocument()
    expect(screen.getByText('Gerado pelo sistema')).toBeInTheDocument()
    expect(screen.queryByText(/Fora da referência/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Laudo (PDF)' }))
    await waitFor(() => expect(window.open).toHaveBeenCalled())

    cleanup()
    asFamily()
    renderAt(`/app/health/examinations/${id}`)
    expect(await screen.findByText(/Laudo da clínica/)).toBeInTheDocument()
    expect(screen.queryByText(/Fora da referência/)).not.toBeInTheDocument()
  })

  it('desligar "Gerar laudo" conclui sem documento gerado; descartar apaga o rascunho', async () => {
    const id = await pendingExam()
    asClinic(ADMIN)
    renderAt(`/clinic/exams/${id}/results`)
    await screen.findByLabelText('Parâmetro 1')
    type('Parâmetro 1', 'Glicemia')
    type('Valor 1', '90')
    fireEvent.click(await screen.findByRole('button', { name: 'Guardar rascunho' }))
    await screen.findByText('Rascunho guardado.')
    fireEvent.click(screen.getByRole('button', { name: 'Descartar rascunho' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Descartar' }))
    expect(await screen.findByText('Rascunho descartado.')).toBeInTheDocument()
    expect(db.examResultDrafts).toHaveLength(0)

    type('Parâmetro 1', 'Glicemia')
    type('Valor 1', '90')
    fireEvent.click(screen.getByRole('switch', { name: 'Gerar laudo em PDF' }))
    fireEvent.click(screen.getByRole('button', { name: 'Concluir exame' }))
    expect(await screen.findByText('Resultados emitidos.')).toBeInTheDocument()
    expect(db.documents.some((d) => d.resourceId === id && d.generatedBySystem)).toBe(false)
    expect(await screen.findByText('Sem laudo gerado para este exame.')).toBeInTheDocument()
  })
})
