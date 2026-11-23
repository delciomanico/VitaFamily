import { BRAND_BACKGROUND } from '@/components/layout/useBrandBackground'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { db, resetDb } from '@/mocks/db'
import { routes } from './router'

/** Formulários como folha por cima do ecrã de onde se parte: abrir, fechar, descartar, guardar e ligação direta. */
function renderAt(path: string, entries: string[] = [path]) {
  const router = createMemoryRouter(routes, { initialEntries: entries, initialIndex: entries.length - 1 })
  render(
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>,
  )
  return router
}

const dialog = (name: string) => screen.getByRole('dialog', { name })

/** Espera que a folha tenha o formulário (e não a folha provisória de carregamento) e devolve-a. */
async function readySheet(name: string, marker: string | RegExp) {
  await screen.findByRole('button', { name: marker })
  return dialog(name)
}

/** Receita/exame: a folha abre primeiro com «fotografar» (M16); «Preencher à mão» abre o formulário vazio. */
async function openManual(name: string, marker: string | RegExp) {
  fireEvent.click(await screen.findByRole('button', { name: 'Preencher à mão' }))
  return readySheet(name, marker)
}

beforeEach(() => {
  cleanup()
  resetDb()
  window.sessionStorage.clear()
  window.sessionStorage.setItem('vf.session.userId', 'usr_monarca')
})

describe('nova receita (família)', () => {
  it('a ligação direta abre a lista por baixo e a folha por cima; «Voltar» sem alterações fecha', async () => {
    const router = renderAt('/app/health/prescriptions/new')
    const sheet = await openManual('Adicionar receita', 'Continuar')
    expect(await screen.findByRole('heading', { name: 'Receitas', level: 1 })).toBeInTheDocument()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Voltar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/health/prescriptions'))
    expect(screen.queryByRole('dialog', { name: 'Adicionar receita' })).not.toBeInTheDocument()
  })

  it('com alterações, fechar pergunta «Descartar alterações?»; «Não» continua e «Sim» descarta', async () => {
    const router = renderAt('/app/health/prescriptions/new')
    const sheet = await openManual('Adicionar receita', 'Continuar')
    fireEvent.change(await within(sheet).findByLabelText('Data da receita'), { target: { value: '2025-01-02' } })

    fireEvent.click(within(sheet).getByRole('button', { name: 'Voltar' }))
    const confirm = await screen.findByRole('dialog', { name: 'Descartar alterações?' })
    fireEvent.click(within(confirm).getByRole('button', { name: 'Não, continuar a escrever' }))
    expect(router.state.location.pathname).toBe('/app/health/prescriptions/new')
    expect(within(dialog('Adicionar receita')).getByLabelText('Data da receita')).toHaveValue('2025-01-02')

    // Esc também pede confirmação (não fecha logo).
    fireEvent(dialog('Adicionar receita'), new Event('cancel', { cancelable: true }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim, descartar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/health/prescriptions'))
  })

  it('guardar fecha a folha, mostra o aviso e a lista passa a ter a receita', async () => {
    const before = db.prescriptions.length
    const router = renderAt('/app/health/prescriptions/new')
    const sheet = await openManual('Adicionar receita', 'Continuar')
    fireEvent.click(within(sheet).getByRole('button', { name: 'Continuar' }))
    fireEvent.input(await within(sheet).findByLabelText('Nome'), { target: { value: 'Amoxicilina' } })
    fireEvent.input(within(sheet).getByLabelText('Dosagem'), { target: { value: '500 mg' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Continuar' }))
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Guardar receita' }))

    expect(await screen.findByText('Receita registada.')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/health/prescriptions'))
    expect(db.prescriptions.length).toBe(before + 1)
    // A lista (que ficou montada por baixo) recarregou: passou de 2 para 3 receitas.
    await waitFor(() => expect(screen.getAllByText(/\d medicamentos?$/)).toHaveLength(3))
  })
})

describe('novo exame e marcar consulta (família)', () => {
  it('novo exame: a ligação direta abre por cima da lista e guardar atualiza a lista', async () => {
    const before = db.examinations.length
    const router = renderAt('/app/health/examinations/new')
    const sheet = await openManual('Adicionar exame', 'Continuar')
    expect(await screen.findByRole('heading', { name: 'Exames', level: 1 })).toBeInTheDocument()
    fireEvent.input(within(sheet).getByLabelText('Tipo de exame'), { target: { value: 'Análises' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Continuar' }))
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Continuar' }))
    fireEvent.click(await within(sheet).findByRole('button', { name: 'Guardar exame' }))
    expect(await screen.findByText('Exame registado.')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/health/examinations'))
    expect(db.examinations.length).toBe(before + 1)
  })

  it('marcar consulta: abre por cima da Agenda e «Voltar» fecha sem perguntar quando nada foi escrito', async () => {
    const router = renderAt('/app/appointments/new')
    const sheet = await readySheet('Marcar consulta', 'Continuar')
    expect(await screen.findByRole('heading', { name: 'Agenda', level: 1 })).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Voltar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/appointments'))
  })
})

describe('perfil de saúde e família (família)', () => {
  it('editar perfil: abre por cima do perfil com ?editar e «Fechar» sem alterações fecha', async () => {
    const router = renderAt('/app/health/profile?editar')
    const sheet = await readySheet('Editar perfil', 'Guardar')
    expect(await screen.findByRole('heading', { name: 'Perfil de saúde', level: 1 })).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })

  it('adicionar membro: folha por cima da lista, guardar atualiza e mostra o aviso', async () => {
    const router = renderAt('/app/family')
    fireEvent.click(await screen.findByRole('button', { name: 'Adicionar membro' }))
    const sheet = await screen.findByRole('dialog', { name: 'Adicionar membro' })
    expect(router.state.location.search).toBe('?adicionar=1')
    fireEvent.input(within(sheet).getByLabelText('Nome'), { target: { value: 'Rita Lopes' } })
    fireEvent.input(within(sheet).getByLabelText('Data de nascimento'), { target: { value: '2018-05-05' } })
    fireEvent.change(within(sheet).getByLabelText('Relação'), { target: { value: 'DAUGHTER' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Adicionar' }))
    expect(await screen.findByText('Membro adicionado.')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(await screen.findByText('Rita Lopes')).toBeInTheDocument()
  })
})

describe('definições, relógio e medicamento (família)', () => {
  it('alterar palavra-passe: a ligação direta abre por cima das Configurações; Esc com dados pede confirmação', async () => {
    const router = renderAt('/app/settings/security')
    const sheet = await readySheet('Alterar palavra-passe', 'Alterar palavra-passe')
    expect(await screen.findByRole('heading', { name: 'Perfil', level: 1 })).toBeInTheDocument()
    fireEvent.input(within(sheet).getByLabelText('Palavra-passe atual'), { target: { value: 'qualquer' } })
    fireEvent(sheet, new Event('cancel', { cancelable: true }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sim, descartar' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/settings'))
  })

  it('conectar relógio: passo a passo em ecrã inteiro por cima do Relógio', async () => {
    const router = renderAt('/app/watch/connect')
    const sheet = await readySheet('Conectar relógio', 'Continuar')
    expect(within(sheet).getByRole('button', { name: 'Continuar' })).toBeDisabled()
    fireEvent.click(within(sheet).getByLabelText(/Autorizo a Vita Family/))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Continuar' }))
    expect(await within(sheet).findByRole('heading', { name: 'Escolha o relógio' })).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Voltar' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'Voltar' }))
    // De volta ao 1.º passo, «Voltar» fecha a folha.
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/watch'))
  })

  it('editar medicamento: abre por cima do detalhe com ?editar e fecha sem alterações', async () => {
    const router = renderAt('/app/health/medications/med_amox?editar')
    const sheet = await readySheet('Editar medicamento', 'Guardar')
    expect(await screen.findByRole('heading', { name: 'Medicamento', level: 1 })).toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fechar' }))
    await waitFor(() => expect(router.state.location.search).toBe(''))
  })
})

describe('fundo azul sólido (interruptor BRAND_BACKGROUND)', () => {
  it('a shell da família só liga `html.on-brand` se o interruptor estiver ligado, e desliga ao sair', async () => {
    renderAt('/app/health')
    await screen.findByRole('heading', { name: 'Minha saúde', level: 1 })
    if (BRAND_BACKGROUND) expect(document.documentElement).toHaveClass('on-brand')
    else expect(document.documentElement).not.toHaveClass('on-brand')
    cleanup()
    expect(document.documentElement).not.toHaveClass('on-brand')
  })
})
