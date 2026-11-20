import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/mocks/data/users'
import { resetDb } from '@/mocks/db'
import { resetConsultationsDb } from '@/mocks/consultationsDb'
import { resetMarketplaceDb } from '@/mocks/marketplaceDb'
import { DEMO_PROFESSIONAL_PASSWORD, resetProfessionalDb } from '@/mocks/professionalDb'
import { paths } from './paths'
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

async function loginFamily(path: string) {
  const router = renderAt(path)
  await screen.findByRole('heading', { name: 'Entrar' })
  type('E-mail', DEMO_EMAIL)
  type('Palavra-passe', DEMO_PASSWORD)
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
  return router
}

function signInAsAdmin(path: string) {
  window.sessionStorage.setItem('vf.session.userId', 'usr_platform_admin')
  return renderAt(path)
}

async function loginProfessional(email: string, path: string) {
  const router = renderAt(paths.professionalLogin)
  await screen.findByRole('tab', { name: 'Médico ou especialista', selected: true })
  type(/E-mail/, email)
  type('Palavra-passe', DEMO_PROFESSIONAL_PASSWORD)
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
  await waitFor(() => expect(router.state.location.pathname).not.toBe('/entrar'))
  await router.navigate(path)
  return router
}

beforeEach(() => {
  resetDb()
  resetProfessionalDb()
  resetMarketplaceDb()
  resetConsultationsDb()
  window.sessionStorage.clear()
})

/** Vocabulário técnico que a família nunca vê (estados do contrato, antivírus, disputa em inglês…). */
const TECHNICAL = /\b(REQUESTED|CONFIRMED|AWAITING_PROOF|PROOF_SUBMITTED|DISPUTED|CLEAN|INFECTED|PENDING|antiv[ií]rus|payload|bookingId|processId)\b/

describe('marcar e avaliar (família)', () => {
  it('perfil: resumo e avaliações anónimas; marcar escolhe horário, pede termos e leva à marcação com «a aguardar resposta»', async () => {
    const router = await loginFamily(paths.marketplaceProfessional('pro_pub_psico1', 'spc_psico'))
    expect(await screen.findByRole('heading', { name: 'Dra. Teresa Neto' })).toBeInTheDocument()
    expect(await screen.findByText(/4,8/)).toBeInTheDocument()
    expect(await screen.findByText('Comentário ocultado pela moderação.')).toBeInTheDocument()
    expect(screen.getByText('Resposta do profissional')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Marcar consulta' }))
    const dialog = await screen.findByRole('dialog')
    // Passo a passo: um assunto por ecrã, com «Passo X de Y».
    expect(await within(dialog).findByRole('heading', { name: 'Para quem é a consulta?' })).toBeInTheDocument()
    expect(within(dialog).getByRole('progressbar')).toHaveAttribute('aria-valuetext', expect.stringMatching(/^Passo 1 de \d$/))
    const next = () => within(dialog).getByRole('button', { name: /^(Continuar|Pedir marcação)$/ })
    // Sem escolher, não avança.
    expect(next()).toBeDisabled()
    fireEvent.click(await within(dialog).findByLabelText(/\(eu\)/))
    fireEvent.click(next())

    // Com vários serviços há um passo para escolher (fica o já pré-escolhido).
    const stepHeading = await within(dialog).findByRole('heading', { name: /^(Que serviço quer\?|Quando prefere\?)$/ })
    if (stepHeading.textContent === 'Que serviço quer?') fireEvent.click(next())

    const group = await within(dialog).findByRole('group', { name: 'Horários livres' })
    expect(next()).toBeDisabled()
    fireEvent.click(within(group).getAllByRole('button')[0]!)
    fireEvent.click(next())

    expect(await within(dialog).findByRole('heading', { name: 'Confirme o pedido' })).toBeInTheDocument()
    expect(within(dialog).getByText('Não substitui atendimento de urgência.')).toBeInTheDocument()
    // Textos legais provisórios marcados (OP-112).
    expect(within(dialog).getAllByText(/\[PROVISÓRIO\]/).length).toBeGreaterThanOrEqual(2)
    // Sem aceitar os termos, não marca.
    expect(within(dialog).getByRole('button', { name: 'Pedir marcação' })).toBeDisabled()
    fireEvent.click(within(dialog).getByLabelText('Li e aceito os termos'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pedir marcação' }))

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/app\/bookings\/mem_monarca\/.+/))
    expect((await screen.findAllByText('A aguardar resposta do profissional')).length).toBeGreaterThan(0)
    expect(await screen.findByText('O profissional ainda tem de responder.')).toBeInTheDocument()
    expect(screen.getByText(/As instruções de pagamento aparecem quando o profissional confirmar/)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(TECHNICAL)
  })

  it('lista de marcações: estados na linguagem da família e o que falta; sem vocabulário técnico', async () => {
    await loginFamily(paths.bookings)
    expect(await screen.findByText('Dra. Teresa Neto')).toBeInTheDocument()
    expect(screen.getByText('Dr. Paulo Quissanga')).toBeInTheDocument()
    expect(screen.getByText('Falta enviar o comprovativo de pagamento.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(TECHNICAL)
    fireEvent.click(screen.getByRole('button', { name: 'Anteriores' }))
    expect((await screen.findAllByText('Pode avaliar esta consulta.')).length).toBeGreaterThan(0)
    expect(screen.getByText('Em análise pela Vita Family')).toBeInTheDocument()
  })

  it('marcação confirmada: instruções de pagamento e envio do comprovativo; ficheiro não aceite dá a ajuda', async () => {
    await loginFamily(paths.booking('mem_pedro', 'bkg_seed_conf'))
    expect(await screen.findByText('Como pagar')).toBeInTheDocument()
    expect(screen.getByText(/A Vita Family não recebe nem confirma pagamentos/)).toBeInTheDocument()
    expect(await screen.findByText('Falta enviar o comprovativo de pagamento.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Comprovativo de pagamento'), { target: { files: [new File(['x'], 'virus.exe', { type: 'application/x-msdownload' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comprovativo' }))
    expect((await screen.findAllByText('Use PDF, JPG ou PNG, até 10 MB.')).length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('Comprovativo de pagamento'), { target: { files: [new File(['%PDF'], 'transferencia.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Enviar comprovativo' }))
    expect(await screen.findByText('O profissional ainda tem de confirmar o pagamento.')).toBeInTheDocument()
    expect(await screen.findByText('Enviado')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(TECHNICAL)
  })

  it('cancelar avisa «em cima da hora» quando faltam menos de 24 h e fecha a marcação', async () => {
    await loginFamily(paths.booking('mem_pedro', 'bkg_seed_conf'))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancelar marcação' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Pode cancelar até à hora da consulta/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sim, cancelar marcação' }))
    expect((await screen.findAllByText('Cancelada')).length).toBeGreaterThan(0)
    expect(screen.getByText(/Cancelada por si/)).toBeInTheDocument()
  })

  it('avaliar uma consulta concluída: nota e comentário anónimos; depois vê a avaliação e o processo fica sem pendentes', async () => {
    await loginFamily(paths.booking('mem_monarca', 'bkg_seed_done'))
    expect(await screen.findByText('A sua avaliação')).toBeInTheDocument()
    expect(screen.getByText(/A sua avaliação é anónima|anónima e pública/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Publicar avaliação' }))
    expect(await screen.findByText('Escolha uma nota de 1 a 5.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '4 estrelas' }))
    type(/Comentário/, 'Explicou tudo com calma.')
    fireEvent.click(screen.getByRole('button', { name: 'Publicar avaliação' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Publicar avaliação' })).not.toBeInTheDocument())
    expect(await screen.findByText('Explicou tudo com calma.')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Alterar avaliação' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Não falta nada.')).toBeInTheDocument())
  })

  it('o processo da marcação abre-se pela página de processos com «o que falta» em linguagem simples', async () => {
    const router = await loginFamily(paths.process('mem_monarca', 'prc_bkg_seed_done'))
    expect(await screen.findByText('Pode avaliar esta consulta.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Ver marcação' }))
    await waitFor(() => expect(router.state.location.pathname).toBe(paths.booking('mem_monarca', 'bkg_seed_done')))
  })

  it('«Como ordenamos» v2 lista as avaliações de quem consultou com o peso e mantém a frase do pagamento', async () => {
    await loginFamily(paths.marketplaceRanking)
    expect(await screen.findByText('Avaliações de quem consultou')).toBeInTheDocument()
    expect(screen.getByText('40%')).toBeInTheDocument()
    expect(screen.getByText('O pagamento e os destaques pagos nunca influenciam a ordem.')).toBeInTheDocument()
  })
})

describe('portal do profissional: marcações e avaliações', () => {
  it('só vê o rótulo; confirma um pedido e decide o comprovativo', async () => {
    await loginProfessional('marta.lopes@exemplo.ao', paths.professionalBookings)
    // O Início também lista marcações: espera-se pelo separador certo antes de ler a lista.
    await screen.findByRole('heading', { name: 'Marcações' })
    expect(await screen.findByText('Pai do Pedro')).toBeInTheDocument()
    expect(screen.getByText('Comprovativo por analisar.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/mem_|fam_|usr_/)

    fireEvent.click(screen.getByText('Pai do Pedro'))
    fireEvent.click(await screen.findByRole('button', { name: 'Confirmar marcação' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sim, confirmar' }))
    expect(await screen.findByText('Confirmada')).toBeInTheDocument()

    cleanup()
    // A sessão do profissional continua na aba: abre-se a rota diretamente.
    renderAt(paths.professionalBooking('bkg_seed_pa_conf'))
    expect(await screen.findByText('Comprovativo de pagamento')).toBeInTheDocument()
    expect(screen.getByText(/A Vita Family não valida o dinheiro/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar pagamento' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sim, confirmar' }))
    expect(await screen.findByText('Pagamento confirmado')).toBeInTheDocument()
  })

  it('recusar o comprovativo exige motivo', async () => {
    await loginProfessional('marta.lopes@exemplo.ao', paths.professionalBooking('bkg_seed_pa_conf'))
    fireEvent.click(await screen.findByRole('button', { name: 'Recusar comprovativo' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sim, recusar' }))
    expect(await within(dialog).findByText('Preencha este campo.')).toBeInTheDocument()
    fireEvent.input(within(dialog).getByLabelText('Motivo'), { target: { value: 'Valor incorreto' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sim, recusar' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Motivo indicado: Valor incorreto')).toBeInTheDocument()
  })

  it('avaliações: anónimas, responde uma vez e denuncia', async () => {
    await loginProfessional('marta.lopes@exemplo.ao', paths.professionalReviews)
    expect(await screen.findByText('Gostei; o estúdio podia ter mais ventilação.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Responder' }))
    let dialog = await screen.findByRole('dialog')
    fireEvent.input(within(dialog).getByLabelText('Resposta'), { target: { value: 'Obrigada pelo comentário.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publicar resposta' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Obrigada pelo comentário.')).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Denunciar' })[0]!)
    dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enviar denúncia' }))
    expect((await screen.findAllByText('Denunciada')).length).toBeGreaterThan(0)
  })
})

describe('administração: disputas e denúncias de avaliações', () => {
  it('disputa: vê a marcação e o comprovativo (sem família) e decide', async () => {
    signInAsAdmin(paths.adminPaymentDisputes)
    expect(await screen.findByRole('heading', { name: 'Disputas de pagamento' })).toBeInTheDocument()
    fireEvent.click(await screen.findByText('Dr. Paulo Quissanga'))
    expect(await screen.findByText('Não encontro a transferência na minha conta.')).toBeInTheDocument()
    expect(screen.getByText('Paguei no dia da consulta; o comprovativo do banco está anexado.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Descarregar comprovativo' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Monarca|mem_|fam_|usr_/)

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar o pagamento' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmar o pagamento' }))
    expect(await screen.findByText('Decidida')).toBeInTheDocument()
    expect(screen.getByText('Decisão')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Descarregar comprovativo' })).not.toBeInTheDocument()
  })

  it('denúncia de avaliação: vê o texto, oculta só o comentário', async () => {
    signInAsAdmin(paths.adminReviewReports)
    expect(await screen.findByRole('heading', { name: 'Denúncias de avaliações' })).toBeInTheDocument()
    fireEvent.click(await screen.findByText('Fora do assunto'))
    expect(await screen.findByText('Boa consulta; a ligação falhou um pouco no início.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ocultar o comentário' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ocultar o comentário' }))
    expect(await screen.findByText('Comentário já ocultado')).toBeInTheDocument()
    expect(screen.getByText('Decidida')).toBeInTheDocument()
  })
})
