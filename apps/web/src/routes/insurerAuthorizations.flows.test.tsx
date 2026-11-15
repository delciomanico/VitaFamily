import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { resetDb } from '@/mocks/db'
import * as clinic from '@/mocks/handlers/clinicAuthorizations'
import { routes } from './router'

const asInsurer = (id: string) => window.sessionStorage.setItem('vf.insurance.session.accountId', id)

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

const nav = () => {
  const navs = screen.getAllByRole('navigation', { name: 'Portal da seguradora' })
  return within(navs[navs.length - 1]!)
}

async function seedRequest() {
  return clinic.createAuthorization(
    'cac_horizonte_admin',
    { insurerId: 'ins_aurora', cardNumber: 'AUR-000001', serviceCode: 'IMG-RX', requestedAmount: 1000, expectedOn: '2026-12-30', justification: 'Pedido administrativo' },
    new Date('2026-11-20T10:00:00.000Z'),
  )
}

beforeEach(() => {
  resetDb()
  window.sessionStorage.clear()
})
afterEach(cleanup)

describe('portal da seguradora: autorizações por papel', () => {
  it('Analista vai para a fila e vê Autorizações e Aprovação automática; não vê beneficiários', async () => {
    asInsurer('iac_aurora_analyst')
    const router = renderAt('/insurance')
    await waitFor(() => expect(router.state.location.pathname).toBe('/insurance/authorizations'))
    expect(await screen.findByRole('heading', { name: 'Autorizações' })).toBeInTheDocument()
    expect(nav().getByRole('link', { name: 'Aprovação automática' })).toBeInTheDocument()
    expect(nav().queryByRole('link', { name: 'Beneficiários' })).not.toBeInTheDocument()
  })

  it('Agente e Gestor de beneficiários não acedem à fila por URL', async () => {
    asInsurer('iac_aurora_agent')
    const router = renderAt('/insurance/authorizations')
    await waitFor(() => expect(router.state.location.pathname).toBe('/insurance'))
  })
})

describe('decidir um pedido', () => {
  it('o analista abre o pedido, aprova e o estado muda; o aviso do texto visível aparece ao recusar', async () => {
    const request = await seedRequest()
    asInsurer('iac_aurora_analyst')
    renderAt('/insurance/authorizations')
    fireEvent.click(await screen.findByRole('link', { name: /Radiografia/ }))
    expect(await screen.findByRole('heading', { name: 'Radiografia' })).toBeInTheDocument()
    expect(screen.getByText(/Esta informação não é mostrada à clínica/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reverter aprovação' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recusar' }))
    expect(await screen.findByText(/Escreva só o motivo administrativo/)).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Voltar' }))

    fireEvent.click(screen.getByRole('button', { name: 'Aprovar' }))
    fireEvent.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Aprovar' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reverter aprovação' })).toBeInTheDocument())
    expect(screen.getByText(/Código/)).toBeInTheDocument()
    expect((await clinic.getAuthorization('cac_horizonte_admin', request.id)).status).toBe('APPROVED')
  })

  it('o supervisor não decide pedidos normais: só consulta', async () => {
    const request = await seedRequest()
    asInsurer('iac_aurora_supervisor')
    renderAt(`/insurance/authorizations/${request.id}`)
    expect(await screen.findByRole('heading', { name: 'Radiografia' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprovar' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Atribuir a um analista' })).toBeInTheDocument()
  })
})

describe('regras de aprovação automática', () => {
  it('o supervisor cria uma regra; o analista só vê', async () => {
    asInsurer('iac_aurora_supervisor')
    renderAt('/insurance/auto-approval')
    expect(await screen.findByText('Sem regras.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Nova regra/ }))
    const dialog = within(await screen.findByRole('dialog'))
    fireEvent.input(dialog.getByLabelText('Nome da regra'), { target: { value: 'Raio-X até 2000' } })
    await waitFor(() => expect(within(dialog.getByLabelText('Serviço')).getByText(/Radiografia/)).toBeInTheDocument())
    fireEvent.change(dialog.getByLabelText('Serviço'), { target: { value: 'svc_rx' } })
    fireEvent.input(dialog.getByLabelText(/Valor máximo/), { target: { value: '2000' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Criar regra' }))
    expect((await screen.findAllByText('Raio-X até 2000')).length).toBeGreaterThan(0)
    cleanup()

    window.sessionStorage.clear()
    asInsurer('iac_aurora_analyst')
    renderAt('/insurance/auto-approval')
    expect((await screen.findAllByText('Raio-X até 2000')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Nova regra/ })).not.toBeInTheDocument()
    expect(screen.getByText('Só o supervisor altera as regras.')).toBeInTheDocument()
  })
})
