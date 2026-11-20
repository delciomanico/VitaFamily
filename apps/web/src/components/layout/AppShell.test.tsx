import { render, screen, within } from '@testing-library/react'
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
        children: [
          {
            path: '*',
            element: (
              <Page title="Página de teste" backTo="/app">
                conteúdo
              </Page>
            ),
          },
        ],
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
  // Dados criados num instante passado fixo (meio-dia); os alertas por ler dependem da hora real do teste.
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
    expect(await within(sidebar).findByRole('link', { name: /^Alertas, \d+ por ler$/ })).toHaveAttribute(
      'href',
      '/app/alerts',
    )
  })

  it('marca como ativa a secção atual e não a Início', () => {
    renderAt('/app/health/prescriptions')
    const sidebar = screen.getByRole('navigation', { name: 'Navegação principal' })
    expect(within(sidebar).getByRole('link', { name: 'Saúde' })).toHaveAttribute('aria-current', 'page')
    expect(within(sidebar).getByRole('link', { name: 'Início' })).not.toHaveAttribute('aria-current')
  })

  it('no telemóvel tem a barra inferior com poucas áreas e o perfil no fim', async () => {
    renderAt('/app/health')
    const bar = screen.getByRole('navigation', { name: 'Barra inferior' })
    const links = within(bar).getAllByRole('link')
    expect(links.map((l) => l.textContent)).toEqual(['Início', 'Saúde', 'Marcações', 'Conversas', expect.stringMatching(/Perfil$/)])
    expect(links[1]).toHaveAttribute('aria-current', 'page')
    expect(links[4]).toHaveAttribute('href', '/app/settings')
  })

  it('a faixa tem voltar, título e o sino dos alertas com contador', async () => {
    renderAt('/app/health')
    expect(screen.getByRole('heading', { name: 'Página de teste' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Voltar' })).toHaveAttribute('href', '/app')
    expect((await screen.findAllByRole('link', { name: /^Alertas, \d+ por ler$/ }))[0]).toHaveAttribute('href', '/app/alerts')
  })
})
