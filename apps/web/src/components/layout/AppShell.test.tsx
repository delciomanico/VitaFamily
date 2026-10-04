import { fireEvent, render, screen, within } from '@testing-library/react'
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
  it('tem a sidebar como navegação do desktop, com Alertas e contador', async () => {
    renderAt('/app/health')
    const sidebar = screen.getByRole('navigation', { name: 'Navegação principal' })
    for (const label of ['Início', 'Saúde', 'Agenda', 'Família']) {
      expect(within(sidebar).getByRole('link', { name: label })).toBeInTheDocument()
    }
    expect(await within(sidebar).findByRole('link', { name: 'Alertas, 3 por ler' })).toHaveAttribute('href', '/app/alerts')
  })

  it('marca como ativa a secção atual e não a Início', () => {
    renderAt('/app/health/prescriptions')
    const sidebar = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(within(sidebar).getByRole('link', { name: 'Saúde' })).toHaveAttribute('aria-current', 'page')
    expect(within(sidebar).getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
  })

  it('a faixa tem voltar, título e o botão de menu que abre a navegação', async () => {
    renderAt('/app/health')
    expect(screen.getByRole('heading', { name: 'Página de teste' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voltar' })).toHaveAttribute('href', '/app')

    fireEvent.click(await screen.findByRole('button', { name: 'Abrir menu, 3 alertas por ler' }))
    const menu = screen.getByRole('navigation', { name: 'Menu principal', hidden: true })
    for (const label of ['Início', 'Saúde', 'Agenda', 'Família', 'Configurações']) {
      expect(within(menu).getByRole('link', { name: label, hidden: true })).toBeInTheDocument()
    }
  })
})
