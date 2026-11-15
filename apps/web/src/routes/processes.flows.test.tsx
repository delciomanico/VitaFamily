import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { db, resetDb } from '@/mocks/db'
import { raiseAuthorizationAlert } from '@/mocks/handlers/processes'
import { routes } from './router'

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

const asUser = (userId: string) => window.sessionStorage.setItem('vf.session.userId', userId)

beforeEach(() => {
  resetDb()
  window.sessionStorage.clear()
})
afterEach(() => cleanup())

describe('vista da família do pedido à seguradora (fatia 5, ADR-036)', () => {
  it('do alerta ao cartão do processo: abre o processo, mostra o estado simples e marca o alerta como lido', async () => {
    asUser('usr_monarca')
    const [alert] = raiseAuthorizationAlert(db, 'APPROVED', 'prc_aprovado', new Date(Date.now() - 60_000))
    const router = renderAt('/app/alerts')

    fireEvent.click(await screen.findByText('A seguradora aprovou um pedido.'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/processes/mem_maria/prc_aprovado'))

    expect(await screen.findByText(/A seguradora aprovou o pedido\. Válido até/)).toBeInTheDocument()
    expect(screen.getByText('Marque ou compareça no atendimento.')).toBeInTheDocument()
    expect(screen.getByText('A tratar')).toBeInTheDocument()
    expect(db.alerts.find((a) => a.id === alert!.id)?.readAt).toBeDefined()
    // Nada de vocabulário técnico, motivo ou valores.
    expect(document.body.textContent).not.toMatch(/autoriza|guia|recurso|analista|motivo|decisor/i)
  })

  it('pedido em análise mostra a resposta prevista; o passo seguinte é da seguradora', async () => {
    asUser('usr_monarca')
    renderAt('/app/processes/mem_monarca/prc_analise')
    expect(await screen.findByText(/A seguradora está a analisar o pedido\. Resposta prevista até/)).toBeInTheDocument()
    expect(screen.getByText(/A seguradora está a analisar; resposta até/)).toBeInTheDocument()
  })

  it('processo que já não existe (404): «já não está disponível», sem erro técnico', async () => {
    asUser('usr_monarca')
    raiseAuthorizationAlert(db, 'EXPIRING', 'prc_aprovado', new Date(Date.now() - 60_000))
    db.processes.splice(0, db.processes.length) // o processo desapareceu; o alerta fica
    renderAt('/app/processes/mem_maria/prc_aprovado')
    expect(await screen.findByText('Este processo já não está disponível.')).toBeInTheDocument()
    expect(screen.queryByText(/erro|falhou/i)).not.toBeInTheDocument()
  })

  it('quem não gere o membro (Ana) não vê o pedido: «já não está disponível» (sem enumeração)', async () => {
    asUser('usr_ana')
    renderAt('/app/processes/mem_monarca/prc_analise')
    expect(await screen.findByText('Este processo já não está disponível.')).toBeInTheDocument()
    expect(screen.queryByText(/seguradora/i)).not.toBeInTheDocument()
  })

  it('estados «cancelou» e «expirou»: texto da família e passo seguinte; estado desconhecido não mostra o bloco', async () => {
    asUser('usr_monarca')
    const p = db.processes.find((x) => x.id === 'prc_aprovado')!
    Object.assign(p, { familyStatus: 'CANCELLED', nextStep: { code: 'COVERAGE_WITHDRAWN', actor: 'FAMILY' }, coverage: { state: 'WITHDRAWN', appeal: false, partial: false } })
    renderAt('/app/processes/mem_maria/prc_aprovado')
    expect(await screen.findByText('A seguradora cancelou a aprovação. Para saber mais, fale com a seguradora.')).toBeInTheDocument()
    expect(screen.getByText('Cancelado')).toBeInTheDocument()
    cleanup()
    Object.assign(p, { coverage: { state: 'ESTADO_NOVO', appeal: false, partial: false } })
    renderAt('/app/processes/mem_maria/prc_aprovado')
    expect(await screen.findByText('Cancelado')).toBeInTheDocument()
    expect(screen.queryByTestId('coverage-block')).not.toBeInTheDocument()
  })
})
