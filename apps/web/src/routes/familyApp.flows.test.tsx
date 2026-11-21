import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { resetDb } from '@/mocks/db'
import { routes } from './router'

function renderAt(path: string) {
  window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
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

beforeEach(() => {
  resetDb()
  window.sessionStorage.clear()
  cleanup()
})

/** App móvel da família: Perfil, Sair com confirmação e acordeões. */
describe('área da família em app móvel', () => {
  it('Perfil: identidade, atalhos grandes e definições recolhidas em acordeões', async () => {
    renderAt('/app/settings')
    expect(await screen.findByRole('heading', { name: 'Perfil' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Meu perfil de saúde/ })).toHaveAttribute('href', '/app/health/profile')
    expect(screen.getByRole('link', { name: /Partilhas com profissionais/ })).toHaveAttribute('href', '/app/shares')
    // As definições só aparecem quando se abre o acordeão.
    expect(screen.queryByRole('link', { name: /Segurança/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Conta e segurança/ }))
    expect(screen.getByRole('link', { name: /Segurança/ })).toHaveAttribute('href', '/app/settings/security')
  })

  it('Sair pede confirmação em folha com «Sim, sair» e «Não, ficar»', async () => {
    const router = renderAt('/app/settings')
    fireEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Não, ficar' }))
    expect(router.state.location.pathname).toBe('/app/settings')
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sim, sair' }))
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
  })

  it('Início: quatro opções principais e «Mais opções» por baixo, que abre todas as outras numa folha', async () => {
    renderAt('/app')
    expect(await screen.findByRole('link', { name: /Próximo compromisso/ })).toHaveAttribute('href', '/app/appointments/apt_cardio')
    expect(screen.getByRole('link', { name: /Medicamentos, / })).toHaveAttribute('href', '/app/health/medications')
    expect(screen.getAllByRole('link', { name: 'Agenda' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: 'Marcar consulta' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Mais opções/ }))
    const sheet = await screen.findByRole('dialog')
    expect(within(sheet).getByRole('link', { name: 'Marcar consulta' })).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: /Alertas/ })).toBeInTheDocument()
  })
})
