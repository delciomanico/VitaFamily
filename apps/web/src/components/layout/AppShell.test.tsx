import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '@/contexts/AuthContext'
import { resetDb } from '@/mocks/db'
import { sessionStore } from '@/lib/storage'
import { AppShell } from './AppShell'

function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ path: '/app', element: <AppShell />, children: [{ path: '*', element: <p>conteúdo</p> }] }],
    { initialEntries: [path] },
  )
  render(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  )
}

beforeEach(() => {
  // Dados criados num instante passado fixo (meio-dia), para o número de alertas não depender da hora do teste.
  resetDb(new Date(2026, 9, 4, 12, 0))
  sessionStore.setUserId('usr_monarca')
})

describe('AppShell', () => {
  it('renderiza a navegação principal com os 4 destinos', () => {
    renderAt('/app/health')
    const navs = screen.getAllByRole('navigation', { name: 'Navegação principal' })
    expect(navs).toHaveLength(2) // sidebar (desktop) + bottom nav (mobile)
    for (const label of ['Início', 'Saúde', 'Agenda', 'Família']) {
      expect(screen.getAllByRole('link', { name: label })).toHaveLength(2)
    }
  })

  it('marca como ativa a secção atual e não a Início', () => {
    renderAt('/app/health/prescriptions')
    const health = screen.getAllByRole('link', { name: 'Saúde' })
    health.forEach((link) => expect(link).toHaveAttribute('aria-current', 'page'))
    screen.getAllByRole('link', { name: 'Início' }).forEach((link) => expect(link).not.toHaveAttribute('aria-current'))
  })

  it('mostra o número de alertas por ler no sino', async () => {
    renderAt('/app')
    expect(await screen.findByRole('link', { name: 'Alertas, 3 por ler' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Configurações' }).length).toBeGreaterThan(0)
  })
})
