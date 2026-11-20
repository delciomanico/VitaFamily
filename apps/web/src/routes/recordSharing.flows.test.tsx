import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { ToastProvider } from '@/components/ui/Toast'
import { AuthProvider } from '@/contexts/AuthContext'
import { consultationsDb, resetConsultationsDb } from '@/mocks/consultationsDb'
import { DEMO_EMAIL, DEMO_PASSWORD } from '@/mocks/data/users'
import { db, resetDb } from '@/mocks/db'
import * as rs from '@/mocks/handlers/recordSharing'
import { resetMarketplaceDb } from '@/mocks/marketplaceDb'
import { resetProfessionalDb } from '@/mocks/professionalDb'
import { resetRecordSharingDb, setDigitalPrescriptionEnabled } from '@/mocks/recordSharingDb'
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

/** Sessão do profissional demonstrativo `pro_aprovada` (Marta Lopes, bem-estar) aberta diretamente. */
function asProfessional(path: string) {
  window.sessionStorage.setItem('vf.professional.session.accountId', 'pro_aprovada')
  return renderAt(path)
}

beforeEach(() => {
  resetDb()
  resetProfessionalDb()
  resetMarketplaceDb()
  resetConsultationsDb()
  resetRecordSharingDb()
  window.sessionStorage.clear()
})

/** Vocabulário técnico que a família nunca vê. */
const TECHNICAL = /\b(ACTIVE|EXPIRED|REVOKED|CONSUMED|MEDICATION|ALLERGIES|CONDITIONS|APPOINTMENTS|EXAMS|H24|D7|D30|viewOnce|shareId|bookingId|payload|watermark)\b/

describe('partilha com prazo (família)', () => {
  it('numa marcação confirmada: escolhe categorias e prazo, lê o aviso de capturas e partilha; depois pára a partilha', async () => {
    const router = await loginFamily(paths.booking('mem_pedro', 'bkg_seed_conf'))
    fireEvent.click(await screen.findByRole('link', { name: 'Partilhar o registo' }))
    expect(await screen.findByText('Partilhar com')).toBeInTheDocument()
    expect(screen.getByText(/Não conseguimos impedir capturas de ecrã/)).toBeInTheDocument()
    // Textos legais provisórios (OP-128).
    expect(screen.getAllByText(/\[PROVISÓRIO\]/).length).toBeGreaterThanOrEqual(3)
    expect(screen.getAllByRole('checkbox').length).toBeGreaterThanOrEqual(5)
    expect(document.body.textContent).not.toMatch(TECHNICAL)

    fireEvent.click(screen.getByRole('button', { name: 'Partilhar' }))
    expect(await screen.findByText('Escolha pelo menos uma categoria.')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Medicação ativa'))
    fireEvent.click(screen.getByLabelText('Alergias e tipo de sangue'))
    fireEvent.click(screen.getByRole('button', { name: 'Partilhar' }))
    expect(await screen.findByText('Escolha durante quanto tempo.')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/^7 dias/))
    fireEvent.click(screen.getByLabelText('Só pode ser aberta uma vez'))
    fireEvent.click(screen.getByRole('button', { name: 'Partilhar' }))
    expect(await screen.findByText('Confirme que leu o aviso para partilhar.')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Li o aviso e quero partilhar'))
    fireEvent.click(screen.getByRole('button', { name: 'Partilhar' }))

    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/app\/shares\/mem_pedro\/.+/))
    expect(await screen.findByText('Ativa')).toBeInTheDocument()
    expect(screen.getByText('Só pode ser aberta uma vez.')).toBeInTheDocument()
    expect(await screen.findByText('Ainda ninguém abriu esta partilha.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(TECHNICAL)

    fireEvent.click(screen.getByRole('button', { name: 'Parar a partilha' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Parar a partilha' }))
    expect(await screen.findByText('Parada por si')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Parar a partilha' })).not.toBeInTheDocument()
  })

  it('«Quem viu»: nome público, categorias e data de cada abertura', async () => {
    await loginFamily(paths.share('mem_monarca', 'shr_seed_active'))
    expect(await screen.findByRole('heading', { name: 'Quem viu' })).toBeInTheDocument()
    expect(await screen.findByText('Viu: Medicação ativa')).toBeInTheDocument()
    expect(screen.getAllByText('Marta Lopes').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Não conseguimos impedir capturas de ecrã/).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(TECHNICAL)
  })

  it('lista de partilhas: ativas por omissão e terminadas à parte; sem vocabulário técnico', async () => {
    await loginFamily(paths.shares)
    expect((await screen.findAllByText('Marta Lopes')).length).toBe(2)
    expect(screen.getByText('Aberta 1 vez')).toBeInTheDocument()
    expect(screen.getByText('Ainda não foi aberta')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Terminadas' }))
    expect(await screen.findByText('Parada por si')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(TECHNICAL)
  })

  it('o aviso do chat remete para a partilha com prazo', async () => {
    await loginFamily(paths.marketplaceProfessional('pro_pub_psico1', 'spc_psico'))
    fireEvent.click(await screen.findByRole('button', { name: /Conversar|Enviar mensagem|Escrever/ }))
    expect(await screen.findByText(/use a partilha com prazo/)).toBeInTheDocument()
  })
})

describe('portal do profissional: partilhas recebidas', () => {
  it('lista só o rótulo e abre uma visualização única: marca de água e idade; reabrir já não é possível', async () => {
    const router = asProfessional(paths.professionalShares)
    expect(await screen.findByRole('heading', { name: 'Partilhas recebidas' })).toBeInTheDocument()
    expect((await screen.findAllByText('Monarca')).length).toBe(2)
    expect(screen.getByText('Só abre uma vez')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/mem_|fam_|usr_/)

    fireEvent.click(screen.getAllByText('Monarca')[0]!)
    await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/profissional\/partilhas\/.+/))
    const open = await screen.findByRole('button', { name: 'Abrir partilha' })
    fireEvent.click(open)
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Só pode abrir esta partilha uma vez/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abrir' }))

    const viewer = await screen.findByTestId('shared-records')
    expect(within(viewer).getByText('Monarca')).toBeInTheDocument()
    expect(within(viewer).getByText(/\d+ anos/)).toBeInTheDocument()
    expect(within(viewer).getByText('Medicação ativa')).toBeInTheDocument()
    expect(within(viewer).queryByText('Alergias e tipo de sangue')).not.toBeInTheDocument()
    // Marca de água sobreposta ao conteúdo, com o nome público do profissional.
    const watermark = within(viewer).getByTestId('watermark')
    expect(watermark).toHaveAttribute('aria-hidden', 'true')
    expect(watermark.textContent).toContain('Marta Lopes')
    expect(watermark.className).toContain('absolute')
    expect(screen.getByText(/Estes dados são confidenciais/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Já visto')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Abrir partilha' })).not.toBeInTheDocument()

    // Voltando: o conteúdo não fica guardado e a partilha já não abre.
    cleanup()
    asProfessional(paths.professionalShare(router.state.location.pathname.split('/').pop()!))
    expect(await screen.findByText('Esta partilha já foi vista e não pode ser aberta outra vez.')).toBeInTheDocument()
    expect(screen.queryByTestId('shared-records')).not.toBeInTheDocument()
  })

  it('partilha parada pela família: «Indisponível» sem dizer porquê; e se parar durante a abertura, recusa genérica', async () => {
    asProfessional(paths.professionalShare('shr_seed_revoked'))
    expect(await screen.findByText('Indisponível')).toBeInTheDocument()
    expect(screen.getByText('Esta partilha já não está disponível.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Abrir partilha' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/revog|parada|prazo/i)
    cleanup()

    asProfessional(paths.professionalShare('shr_seed_active'))
    const open = await screen.findByRole('button', { name: 'Abrir partilha' })
    await rs.revokeRecordShare('fam_monarca', 'usr_monarca', 'mem_monarca', 'shr_seed_active')
    fireEvent.click(open)
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abrir' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Esta partilha já não está disponível.')
    expect(screen.queryByTestId('shared-records')).not.toBeInTheDocument()
  })

  it('texto livre dos registos aparece como texto, nunca como HTML', async () => {
    db.allergies.push({ id: 'alg_x', familyId: 'fam_monarca', memberId: 'mem_monarca', name: '<img src=x onerror=alert(1)> Pólen' })
    consultationsDb.bookings.find((b) => b.id === 'bkg_seed_pa_done')!.offer.category = 'HEALTH'
    const share = await rs.createRecordShare('fam_monarca', 'usr_monarca', 'mem_monarca', { bookingId: 'bkg_seed_pa_done', categories: ['ALLERGIES'], validity: 'H24' })
    asProfessional(paths.professionalShare(share.id))
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir partilha' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abrir' }))
    const viewer = await screen.findByTestId('shared-records')
    expect(within(viewer).getByText(/<img src=x onerror=alert\(1\)> Pólen/)).toBeInTheDocument()
    expect(viewer.querySelector('img')).toBeNull()
  })
})

describe('receita digital (atrás da flag)', () => {
  it('desligada: o profissional não vê o botão e a rota mostra que não está disponível', async () => {
    const router = asProfessional(paths.professionalBooking('bkg_seed_pa_done'))
    expect(await screen.findByText('Concluída')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /receita/i })).not.toBeInTheDocument()
    await router.navigate(paths.professionalPrescription('bkg_seed_pa_done'))
    expect(await screen.findByText('Não é possível emitir receita nesta marcação.')).toBeInTheDocument()
  })

  it('ligada: o profissional emite; a família vê «Receita disponível», lê o conteúdo e só ajusta os horários', async () => {
    setDigitalPrescriptionEnabled(true)
    consultationsDb.bookings.find((b) => b.id === 'bkg_seed_pa_done')!.offer.category = 'HEALTH'
    asProfessional(paths.professionalBooking('bkg_seed_pa_done'))
    // Secção recolhida: abre-se «Receita» para chegar à ação.
    fireEvent.click(await screen.findByRole('button', { name: /^Receita/ }))
    fireEvent.click(await screen.findByRole('link', { name: 'Emitir receita' }))
    expect(await screen.findByText(/\[PROVISÓRIO\]/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Emitir receita' }))
    expect(await screen.findByText('Indique o medicamento e a dosagem.')).toBeInTheDocument()
    type('Medicamento', 'Ibuprofeno')
    type('Dosagem', '400 mg')
    fireEvent.click(screen.getByRole('button', { name: 'Emitir receita' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Emitir' }))
    expect(await screen.findByText(/Receita emitida em/)).toBeInTheDocument()
    expect(screen.getByText('Ibuprofeno')).toBeInTheDocument()
    cleanup()

    await loginFamily(paths.booking('mem_monarca', 'bkg_seed_pa_done'))
    expect(await screen.findByText('Receita disponível')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Ver a receita' }))
    expect(await screen.findByText('Emitida por profissional')).toBeInTheDocument()
    expect(screen.getByText(/só pode ser lida/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Editar/ })).not.toBeInTheDocument()
    const plan = db.medicationPlans.find((p) => p.name === 'Ibuprofeno')!
    fireEvent.click(screen.getByRole('link', { name: /Ibuprofeno/ }))
    await screen.findByText('Receita associada')
    expect(plan.status).toBe('ACTIVE')
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    // Só os horários se ajustam: sem campos de nome nem dosagem.
    expect(await screen.findByRole('button', { name: 'Guardar horários' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Nome')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Dosagem')).not.toBeInTheDocument()
    fireEvent.input(screen.getByLabelText('Horário 1'), { target: { value: '09:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar horários' }))
    expect(await screen.findByText('Medicamento atualizado.')).toBeInTheDocument()
    expect(db.medicationPlans.find((p) => p.id === plan.id)).toMatchObject({ name: 'Ibuprofeno', times: ['09:30'] })
  })
})
