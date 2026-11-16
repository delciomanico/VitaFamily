import { cleanup, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { db, resetDb } from '@/mocks/db'
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

describe('cartão do processo (episódio de cuidado)', () => {
  it('mostra o estado simples e o que falta, sem vocabulário técnico nem seguro', async () => {
    asUser('usr_monarca')
    renderAt('/app/processes/mem_monarca/prc_consulta')
    expect(await screen.findByText('Marcado')).toBeInTheDocument()
    expect(screen.getByText('Está tudo pronto para o atendimento.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver consulta' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/seguradora|seguro|autoriza|cobertura/i)
  })

  it('processo que já não existe (404): «já não está disponível», sem erro técnico', async () => {
    asUser('usr_monarca')
    db.processes.splice(0, db.processes.length)
    renderAt('/app/processes/mem_monarca/prc_consulta')
    expect(await screen.findByText('Este processo já não está disponível.')).toBeInTheDocument()
    expect(screen.queryByText(/erro|falhou/i)).not.toBeInTheDocument()
  })

  it('estado cancelado mostra o rótulo do estado', async () => {
    asUser('usr_monarca')
    Object.assign(db.processes[0]!, { familyStatus: 'CANCELLED', nextStep: { code: 'RESCHEDULE', actor: 'FAMILY' } })
    renderAt('/app/processes/mem_monarca/prc_consulta')
    expect(await screen.findByText('Cancelado')).toBeInTheDocument()
    expect(screen.getByText('Pode voltar a marcar.')).toBeInTheDocument()
  })
})
