import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { db, resetDb } from '@/mocks/db'
import { decideAs } from '@/mocks/handlers/clinicAuthorizations'
import { routes } from './router'

/** Fluxo da clínica para pedir autorização (marco B fatia 3): ≤ 4 passos, semáforo sem razões, sem dados clínicos. */
const MANAGER = 'cac_horizonte_rececao'
const DOCTOR = 'cac_horizonte_medica'

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
const asClinic = (id: string) => window.sessionStorage.setItem('vf.clinic.session.accountId', id)
const type = (label: string | RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } })
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }))

/** O botão só fica ativo quando as seguradoras ligadas carregaram. */
async function openWizard() {
  const button = await screen.findByRole('button', { name: 'Pedir autorização' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  return screen.findByRole('dialog')
}

async function startRequest(serviceCode: string) {
  asClinic(MANAGER)
  renderAt('/clinic/authorizations')
  const dialog = await openWizard()
  expect(dialog).toHaveTextContent('Passo 1 de 4')
  type('Número do cartão', 'AUR-000001')
  await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Radiografia' })).toBeInTheDocument())
  fireEvent.change(within(dialog).getByLabelText('Serviço'), { target: { value: serviceCode } })
  click('Ver cobertura')
  return dialog
}

beforeEach(() => {
  resetDb()
  window.sessionStorage.clear()
})
afterEach(cleanup)

describe('portal da clínica: pedir autorização', () => {
  it('cancelar o pedido e remover anexo pedem confirmação', async () => {
    const dialog = await startRequest('IMG-RX')
    await within(dialog).findByText('Precisa de autorização')
    click('Continuar')
    type(/Valor do serviço/, '1 500')
    type('Porque pede a autorização', 'Pedido administrativo')
    click('Rever pedido')
    click('Enviar pedido')
    await screen.findByText('Pedido enviado à seguradora.')
    expect(db.insurerOps.authorizations[0]?.requestedAmount).toBe(1500)
    const detail = (await screen.findAllByRole('dialog')).at(-1)!
    fireEvent.click(await within(detail).findByRole('button', { name: 'Cancelar pedido' }))
    expect(db.insurerOps.authorizations[0]?.status).toBe('IN_REVIEW') // ainda não: pede confirmação
    const confirm = (await screen.findAllByRole('dialog')).at(-1)!
    expect(confirm).toHaveTextContent('Cancelar o pedido?')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancelar pedido' }))
    await waitFor(() => expect(db.insurerOps.authorizations[0]?.status).toBe('CANCELLED'))
  })

  it('o Médico não vê o item nem acede à rota', async () => {
    asClinic(DOCTOR)
    const router = renderAt('/clinic/authorizations')
    await waitFor(() => expect(router.state.location.pathname).toBe('/clinic'))
    expect(screen.queryByRole('link', { name: 'Autorizações' })).not.toBeInTheDocument()
  })

  it('percurso feliz em 4 passos: beneficiário e serviço, semáforo amarelo, detalhes, enviar; o pedido fica «Em análise»', async () => {
    const dialog = await startRequest('IMG-RX')
    expect(await within(dialog).findByText('Precisa de autorização')).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Passo 2 de 4')
    expect(dialog).toHaveTextContent(/30\s?%/) // paciente paga 100 − 70
    expect(dialog).not.toHaveTextContent(/carência|limite|plano básico/i) // a razão nunca aparece
    click('Continuar')

    expect(dialog).toHaveTextContent('Passo 3 de 4')
    expect(within(dialog).getByText('Serviços e exames')).toBeInTheDocument() // guia deduzida do serviço
    expect(within(dialog).getByText(/Não escreva doença, sintomas nem resultados de exames/)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/diagnóstico/i)).not.toBeInTheDocument()
    click('Rever pedido')
    expect(await within(dialog).findByText(/Indique o valor do serviço/)).toBeInTheDocument()
    expect(within(dialog).getByText('Ex.: 15000,50')).toBeInTheDocument()
    type(/Valor do serviço/, '15.000,50')
    type('Porque pede a autorização', 'Pedido pelo serviço de saúde da empresa')
    click('Rever pedido')

    expect(dialog).toHaveTextContent('Passo 4 de 4')
    click('Enviar pedido')
    expect(await screen.findByText('Pedido enviado à seguradora.')).toBeInTheDocument()
    expect(db.insurerOps.authorizations).toHaveLength(1)
    expect(db.insurerOps.authorizations[0]).toMatchObject({ status: 'IN_REVIEW', serviceCode: 'IMG-RX', guideType: 'SERVICES' })
    expect((await screen.findAllByText('Em análise')).length).toBeGreaterThan(0)
  })

  it('serviço que não precisa de autorização (verde): não deixa continuar', async () => {
    const dialog = await startRequest('CONS-GER')
    expect(await within(dialog).findByText('Coberto')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Continuar' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Alterar dados' })).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button', { name: 'Fechar' }).length).toBeGreaterThan(0)
    expect(db.insurerOps.authorizations).toHaveLength(0)
  })

  it('cartão desconhecido: mensagem simples, sem motivo', async () => {
    asClinic(MANAGER)
    renderAt('/clinic/authorizations')
    const dialog = await openWizard()
    type('Número do cartão', 'NAO-EXISTE')
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Radiografia' })).toBeInTheDocument())
    fireEvent.change(within(dialog).getByLabelText('Serviço'), { target: { value: 'IMG-RX' } })
    click('Ver cobertura')
    expect(await within(dialog).findByText(/Não foi possível confirmar cobertura/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Continuar' })).not.toBeInTheDocument()
  })

  it('«falta informação»: mostra o motivo e responde; o pedido volta a «Em análise»', async () => {
    const dialog = await startRequest('IMG-RX')
    await within(dialog).findByText('Precisa de autorização')
    click('Continuar')
    type(/Valor do serviço/, '15000')
    type('Porque pede a autorização', 'Pedido administrativo')
    click('Rever pedido')
    click('Enviar pedido')
    await screen.findByText('Pedido enviado à seguradora.')
    decideAs(db.insurerOps.authorizations[0]!.id, 'INFO_REQUESTED')
    cleanup()
    asClinic(MANAGER)
    renderAt('/clinic/authorizations')
    fireEvent.click(await screen.findByRole('button', { name: /Ver pedido Radiografia/ }))
    const detail = await screen.findByRole('dialog')
    expect(await within(detail).findByText('Falta informação')).toBeInTheDocument()
    expect(within(detail).getByText('Falta o orçamento do serviço.')).toBeInTheDocument()
    fireEvent.click(within(detail).getByRole('button', { name: 'Responder' }))
    fireEvent.input(within(detail).getByLabelText('A sua resposta'), { target: { value: 'Segue o orçamento.' } })
    fireEvent.click(within(detail).getByRole('button', { name: 'Enviar resposta' }))
    await waitFor(() => expect(db.insurerOps.authorizations[0]?.status).toBe('IN_REVIEW'))
  })

  it('recusado dentro do prazo: «Pedir nova análise» cria um novo pedido ligado ao anterior', async () => {
    const dialog = await startRequest('IMG-RX')
    await within(dialog).findByText('Precisa de autorização')
    click('Continuar')
    type(/Valor do serviço/, '15000')
    type('Porque pede a autorização', 'Pedido administrativo')
    click('Rever pedido')
    click('Enviar pedido')
    await screen.findByText('Pedido enviado à seguradora.')
    const first = db.insurerOps.authorizations[0]!
    decideAs(first.id, 'REJECTED')
    cleanup()
    asClinic(MANAGER)
    renderAt('/clinic/authorizations')
    fireEvent.click(await screen.findByRole('button', { name: /Ver pedido Radiografia/ }))
    const detail = await screen.findByRole('dialog')
    fireEvent.click(await within(detail).findByRole('button', { name: 'Pedir nova análise' }))
    fireEvent.input(within(detail).getByLabelText('Porque pede nova análise'), { target: { value: 'Nova informação administrativa.' } })
    const send = within(detail).getAllByRole('button', { name: 'Pedir nova análise' })
    fireEvent.click(send[send.length - 1]!)
    await waitFor(() => expect(db.insurerOps.authorizations).toHaveLength(2))
    expect(db.insurerOps.authorizations[0]).toMatchObject({ parentRequestId: first.id, status: 'IN_REVIEW' })
  })
})
