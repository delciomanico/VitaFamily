import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { DEMO_PASSWORD } from '@/mocks/data/users'
import { resetDb } from '@/mocks/db'
import { DEMO_PROFESSIONAL_EMAIL, resetProfessionalDb } from '@/mocks/professionalDb'
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

const type = (label: string | RegExp, value: string) => fireEvent.input(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  resetDb()
  resetProfessionalDb()
  window.sessionStorage.clear()
})

describe('portal do profissional', () => {
  it('sem sessão, /profissional/perfil vai para o login próprio', async () => {
    const router = renderAt('/profissional/perfil')
    expect(await screen.findByRole('heading', { name: 'Entrar na área do profissional' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/profissional/entrar')
  })

  it('credenciais erradas mostram mensagem amigável', async () => {
    renderAt('/profissional/entrar')
    await screen.findByRole('heading', { name: 'Entrar na área do profissional' })
    type(/E-mail/, DEMO_PROFESSIONAL_EMAIL)
    type('Palavra-passe', 'errada-errada')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('incorretos')
  })

  it('login mostra o estado da validação e o que falta', async () => {
    renderAt('/profissional/entrar')
    await screen.findByRole('heading', { name: 'Entrar na área do profissional' })
    type(/E-mail/, DEMO_PROFESSIONAL_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('heading', { name: 'Estado da validação' })).toBeInTheDocument()
    expect(await screen.findByText('A preencher')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Submeter para validação/ })).toBeDisabled()
  })

  it('suspenso entra em só leitura nos serviços', async () => {
    window.sessionStorage.setItem('vf.professional.session.accountId', 'pro_suspensa')
    renderAt('/profissional/servicos')
    expect(await screen.findByRole('heading', { name: 'Serviços e preços' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('note')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Nova oferta/ })).not.toBeInTheDocument()
  })

  it('aprovado tem o nome de apresentação bloqueado no perfil', async () => {
    window.sessionStorage.setItem('vf.professional.session.accountId', 'pro_aprovada')
    renderAt('/profissional/perfil')
    const name = await screen.findByLabelText(/Nome de apresentação/)
    expect(name).toBeDisabled()
  })
})

describe('admin de profissionais', () => {

  it('a fila lista o pedido pendente', async () => {
    window.sessionStorage.setItem('vf.session.userId', 'usr_platform_admin')
    renderAt('/admin/professionals')
    expect(await screen.findByRole('heading', { name: 'Profissionais' })).toBeInTheDocument()
    expect(await screen.findByText('João Mendes')).toBeInTheDocument()
  })
})
