import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AppShell } from './AppShell'

function renderAt(path: string) {
  const router = createMemoryRouter(
    [{ path: '/app', element: <AppShell />, children: [{ path: '*', element: <p>conteúdo</p> }] }],
    { initialEntries: [path] },
  )
  render(<RouterProvider router={router} />)
}

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

  it('dá acesso a Alertas e Configurações', () => {
    renderAt('/app')
    expect(screen.getByRole('link', { name: 'Alertas' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Configurações' }).length).toBeGreaterThan(0)
  })
})
