import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { resetDb } from '@/mocks/db'
import { healthSummaryService } from '@/services/healthSummary.service'
import { paths } from './paths'
import { routes } from './router'

function renderAt(path: string, userId = 'usr_monarca') {
  window.sessionStorage.setItem('vf.session.userId', userId)
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

const heading = () => screen.findByRole('heading', { name: 'Resumo de saúde' })
/** Abre uma secção (acordeão) pelo título. */
const openSection = async (name: RegExp) => fireEvent.click(await screen.findByRole('button', { name }))

beforeEach(() => {
  // As tomas de demonstração são só as de hoje: a meio da tarde há sempre tomas passadas (de madrugada não havia nenhuma e o teste falhava).
  const afternoon = new Date()
  afternoon.setHours(15, 0, 0, 0)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(afternoon)
  resetDb()
  window.sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Resumo de saúde (UC-RPT-05/05b)', () => {
  it('abre a partir de Saúde e mostra o valor principal, com o detalhe em secções fechadas', async () => {
    renderAt(paths.health)
    fireEvent.click(await screen.findByRole('link', { name: /Resumo de saúde/ }))
    await heading()
    expect(await screen.findByText('Medicamentos tomados')).toBeInTheDocument()
    expect(await screen.findByText(/das tomas do período foram confirmadas/)).toBeInTheDocument()
    // Nada de detalhe de uma só vez.
    for (const name of [/Por medicamento/, /Valores dos exames/, /O que falta registar/]) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-expanded', 'false')
    }
  })

  it('«Mais opções» do Início leva ao Resumo', async () => {
    renderAt(paths.home)
    fireEvent.click(await screen.findByRole('button', { name: /Mais opções/ }))
    expect(await screen.findByRole('link', { name: 'Resumo de saúde' })).toHaveAttribute('href', paths.healthSummary)
  })

  it('o período muda com os atalhos e as datas à escolha respeitam o máximo de 5 anos', async () => {
    const spy = vi.spyOn(healthSummaryService, 'getMemberSummary')
    renderAt(paths.healthSummary)
    await heading()
    const chip12 = await screen.findByRole('button', { name: '12 meses' })
    expect(chip12).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '30 dias' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '30 dias' })).toHaveAttribute('aria-pressed', 'true'))
    await waitFor(() => {
      const period = spy.mock.calls.at(-1)?.[3] as { from: string; to: string }
      const days = (Date.parse(period.to) - Date.parse(period.from)) / 86_400_000
      expect(days).toBe(29)
    })

    fireEvent.click(screen.getByRole('button', { name: 'Escolher datas' }))
    const dialog = await screen.findByRole('dialog', { name: 'Escolher datas', hidden: true })
    fireEvent.change(within(dialog).getByLabelText('De'), { target: { value: '2019-01-01' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ver este período' }))
    expect(await within(dialog).findByText('O período pode ter, no máximo, 5 anos.')).toBeInTheDocument()
  })

  it('mostra carregamento e depois o resumo; em erro oferece tentar de novo', async () => {
    const spy = vi.spyOn(healthSummaryService, 'getMemberSummary').mockRejectedValueOnce(new Error('falhou'))
    renderAt(paths.healthSummary)
    await heading()
    expect(await screen.findByRole('button', { name: /Tentar novamente/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Tentar novamente/i }))
    expect(await screen.findByText('Medicamentos tomados')).toBeInTheDocument()
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('sem exames no período: estado vazio útil com «Adicionar exame» para o fluxo de exame', async () => {
    renderAt(`${paths.healthSummary}?membro=mem_maria`)
    await heading()
    await openSection(/Valores dos exames/)
    expect(await screen.findByText('Ainda não há exames neste período')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Adicionar exame' })).toHaveAttribute('href', paths.examinationNew)
  })

  it('tutela: o tutor vê o resumo do dependente, também por «Toda a família»', async () => {
    renderAt(paths.healthSummary)
    await heading()
    fireEvent.click(await screen.findByRole('button', { name: /Mudar/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Toda a família/, hidden: true }))
    expect(await screen.findByRole('button', { name: /Atividade no período/ })).toBeInTheDocument()
    const joao = await screen.findByRole('link', { name: /João/ })
    fireEvent.click(joao)
    expect(await screen.findByText('Medicamentos tomados')).toBeInTheDocument()
    expect(screen.getByText('Resumo de')).toBeInTheDocument()
  })

  it('quem só vê o que lhe partilham (Ana): só as secções partilhadas, sem ações de adicionar', async () => {
    renderAt(`${paths.healthSummary}?membro=mem_ana`)
    await heading()
    await screen.findByRole('button', { name: /Consultas e exames/ })
    expect(screen.queryByText('Medicamentos tomados')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Por medicamento/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Valores dos exames/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Adicionar/ })).not.toBeInTheDocument()
  })

  it('«O que falta registar» liga aos registos e só fala de completude', async () => {
    renderAt(`${paths.healthSummary}?membro=mem_joao`)
    await heading()
    await openSection(/O que falta registar/)
    const link = await screen.findByRole('link', { name: /consulta passada por fechar/ })
    expect(link.getAttribute('href')).toMatch(/^\/app\/appointments/)
    const section = link.closest('section')!
    expect(section.textContent).not.toMatch(/rotina|recomend|sugerimos|deve marcar/i)
  })

  it('o «Resumo com IA» é só um ponto de extensão inativo, sem imprimir/PDF', async () => {
    renderAt(paths.healthSummary)
    await heading()
    await screen.findByText('Medicamentos tomados')
    const ai = screen.getByText('Resumo com IA').closest('[data-extension]')!
    expect(ai).toHaveAttribute('aria-disabled', 'true')
    expect(within(ai as HTMLElement).getByText('Em breve')).toBeInTheDocument()
    expect(within(ai as HTMLElement).queryByRole('button')).toBeNull()
    expect(within(ai as HTMLElement).queryByRole('link')).toBeNull()
    expect(screen.queryByText(/Imprimir|PDF/)).not.toBeInTheDocument()
  })

  it('vocabulário: sem códigos técnicos nem juízo («fora da referência»), mesmo com tudo aberto', async () => {
    renderAt(`${paths.healthSummary}?membro=mem_joao`)
    await heading()
    await screen.findByText('Medicamentos tomados')
    for (const button of screen.getAllByRole('button', { expanded: false })) fireEvent.click(button)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\b[A-Z]{2,}(_[A-Z]+)+\b/) // BLOOD_TYPE_UNSET, NO_SHOW…
    expect(text).not.toMatch(/\b(TAKEN|NOT_TAKEN|UNCONFIRMED|SCHEDULED|COMPLETED|MEDICATION|EXAMS|WEEK|MONTH)\b/)
    expect(text).not.toMatch(/fora d[ae]s? referência|anormal|alterad[oa]|elevad[oa]|baix[oa] demais/i)
  })
})
