import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_VERIFICATION_CODE } from '@/mocks/data/users'
import { resetDb } from '@/mocks/db'
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

function type(label: string | RegExp, value: string) {
  fireEvent.input(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  resetDb()
  window.sessionStorage.clear()
})

describe('fluxos de autenticação', () => {
  it('sem sessão, /app redireciona para o login', async () => {
    const router = renderAt('/app/health')
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })

  it('login demo leva à página pedida', async () => {
    const router = renderAt('/app/health')
    await screen.findByRole('heading', { name: 'Entrar' })
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('heading', { name: 'Minha saúde' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/app/health')
  })

  it('login demo a partir do login abre a Home com o resumo', async () => {
    renderAt('/login')
    await screen.findByRole('heading', { name: 'Entrar' })
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', DEMO_PASSWORD)
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByRole('heading', { name: /Olá, Monarca/ })).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Próximo compromisso/ })).toHaveAttribute('href', '/app/appointments/apt_cardio')
    expect(screen.getByRole('link', { name: 'Relatórios, 1 pendente' })).toHaveAttribute('href', '/app/reports/family')
    expect(screen.getByRole('link', { name: 'Marcar consulta' })).toHaveAttribute('href', '/app/appointments/new')
  })

  it('credenciais erradas mostram mensagem amigável', async () => {
    renderAt('/login')
    await screen.findByRole('heading', { name: 'Entrar' })
    type('E-mail', DEMO_EMAIL)
    type('Palavra-passe', 'errada')
    fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('E-mail ou palavra-passe incorretos.')).toBeInTheDocument()
  })

  it('registo → verificação → configuração da família', async () => {
    const router = renderAt('/register')
    await screen.findByRole('heading', { name: 'Criar conta' })
    type('Nome', 'Ana Teste')
    type('E-mail', 'ana@exemplo.test')
    type('Data de nascimento', '1990-01-01')
    type(/^Palavra-passe/, 'uma-frase-longa')
    type('Confirmar palavra-passe', 'uma-frase-longa')
    fireEvent.click(screen.getByLabelText(/Li e aceito/))
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    expect(await screen.findByRole('heading', { name: 'Digite o código enviado' })).toBeInTheDocument()
    fireEvent.input(screen.getByLabelText('Dígito 1 de 6'), { target: { value: DEMO_VERIFICATION_CODE } })

    expect(await screen.findByRole('heading', { name: 'Bem-vindo ao Vita Family' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/setup/family')
  })

  it('perfil de saúde: ver, editar e guardar', async () => {
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    renderAt('/app/health/profile')
    expect(await screen.findByText('Asma')).toBeInTheDocument()
    expect(screen.getByText('O+')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Editar perfil' }))
    fireEvent.change(await screen.findByLabelText('Tipo sanguíneo'), { target: { value: 'AB-' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remover Asma' }))
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(await screen.findByText('Perfil atualizado.')).toBeInTheDocument()
    // Espera pela vista (o formulário também contém a opção “AB-”).
    await screen.findByRole('button', { name: 'Editar perfil' })
    expect(screen.getByText('AB-')).toBeInTheDocument()
    expect(screen.getByText('Nenhuma condição registada.')).toBeInTheDocument()
  })

  it('histórico médico filtra por tipo', async () => {
    window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
    renderAt('/app/health/history')
    expect(await screen.findByText('Apendicectomia')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Exames' }))
    expect(screen.queryByText('Apendicectomia')).not.toBeInTheDocument()
    expect(screen.getAllByText('Análises clínicas').length).toBeGreaterThan(0)
  })

  it('registo valida idade mínima e confirmação da palavra-passe', async () => {
    renderAt('/register')
    await screen.findByRole('heading', { name: 'Criar conta' })
    type('Data de nascimento', '2015-01-01')
    type(/^Palavra-passe/, 'uma-frase-longa')
    type('Confirmar palavra-passe', 'outra-frase-longa')
    fireEvent.click(screen.getByRole('button', { name: 'Criar conta' }))
    expect(await screen.findByText(/18 anos ou mais/)).toBeInTheDocument()
    expect(screen.getByText('As palavras-passe não coincidem.')).toBeInTheDocument()
    expect(screen.getByText('É necessário aceitar os termos para continuar.')).toBeInTheDocument()
  })
})
