import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '@/contexts/AuthContext'
import { resetDb } from '@/mocks/db'
import { sessionStore } from '@/lib/storage'
import { AppShell } from './AppShell'
import { Page } from './Page'

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/app',
        element: <AppShell />,
        children: [{ path: '*', element: <Page title="Página de teste" backTo="/app">conteúdo</Page> }],
      },
    ],
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
  it('tem só a sidebar como navegação principal (sem barra inferior)', () => {
    renderAt('/app/health')
    expect(screen.getAllByRole('navigation', { name: 'Navegação principal' })).toHaveLength(1)
    for (const label of ['Início', 'Saúde', 'Agenda', 'Família']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument()
    }
  })

  it('marca como ativa a secção atual e não a Início', () => {
    renderAt('/app/health/prescriptions')
    expect(screen.getByRole('link', { name: 'Saúde' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
  })

  it('a faixa da página tem título, voltar e o sino com os alertas por ler', async () => {
    renderAt('/app/health')
    expect(screen.getByRole('heading', { name: 'Página de teste' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voltar' })).toHaveAttribute('href', '/app')
    expect(await screen.findByRole('link', { name: 'Alertas, 3 por ler' })).toBeInTheDocument()
  })
})
