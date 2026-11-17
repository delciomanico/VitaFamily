import { beforeEach, describe, expect, it } from 'vitest'
import type { AppError } from '@/lib/errors'
import { CREDENTIAL_MAX_BYTES } from '@/lib/professional'
import { professionalSessionStore } from '@/lib/storage'
import type { OfferDuration, OfferMethod, ProfessionalValidationStatus, Weekday } from '@/types/professional'
import { professionalDb, resetProfessionalDb, type MockProfessional } from '../professionalDb'
import * as portal from './professionalPortal'

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'OK',
    (e: AppError) => e.code,
  )

const DEMO_EMAIL = 'profissional@vitafamily.app'
const PASSWORD = 'password'
const NEW_PASSWORD = 'nova-palavra-passe-123'
const CODE = '123456'
const ALL_DAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7]
const DAY = 86_400_000

const pdf = (name = 'cedula.pdf') => new File([new Uint8Array(100)], name, { type: 'application/pdf' })
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString()

function rec(id: string): MockProfessional {
  const found = professionalDb.professionals.find((p) => p.id === id)
  if (!found) throw new Error(`conta de teste ${id} em falta`)
  return found
}

/** Entra como a conta indicada (a sessão da aba é o id da conta, como em `professionalSessionStore`). */
function signIn(id: string) {
  professionalSessionStore.setAccountId(id)
}

beforeEach(() => {
  resetProfessionalDb()
  window.sessionStorage.clear()
})

// ───── Registo, verificação, login e recuperação (UC-MKT-01/02) ─────

describe('registo e verificação (UC-MKT-01)', () => {
  const register = (email: string, password = NEW_PASSWORD) => portal.professionalRegister({ email, password, termsVersion: '2026-11' })

  it('resposta neutra para e-mail novo e para e-mail já existente; só o novo cria conta', async () => {
    const before = professionalDb.professionals.length
    expect(await code(register('nova.pessoa@exemplo.ao'))).toBe('OK')
    expect(await code(register(DEMO_EMAIL))).toBe('OK')
    expect(await code(register(' Nova.Pessoa@Exemplo.ao '))).toBe('OK')
    expect(professionalDb.professionals.length).toBe(before + 1)
  })

  it('palavra-passe com menos de 12 caracteres ⇒ PASSWORD_WEAK; 12 aceites', async () => {
    expect(await code(register('x@exemplo.ao', 'a'.repeat(11)))).toBe('PASSWORD_WEAK')
    expect(await code(register('x@exemplo.ao', 'a'.repeat(12)))).toBe('OK')
  })

  it('e-mail inválido ou sem termos ⇒ VALIDATION_ERROR', async () => {
    expect(await code(register('sem-arroba'))).toBe('VALIDATION_ERROR')
    expect(
      await code(portal.professionalRegister({ email: 'x@exemplo.ao', password: NEW_PASSWORD, termsVersion: '' })),
    ).toBe('VALIDATION_ERROR')
  })

  it('código errado ⇒ INVALID_CODE; código certo ⇒ conta verificada e login possível', async () => {
    await register('nova.pessoa@exemplo.ao')
    expect(await code(portal.professionalVerifyEmail('nova.pessoa@exemplo.ao', '000000'))).toBe('INVALID_CODE')
    expect(await code(portal.professionalVerifyEmail('nova.pessoa@exemplo.ao', CODE))).toBe('OK')
    expect(await code(portal.professionalLogin('nova.pessoa@exemplo.ao', NEW_PASSWORD))).toBe('OK')
    expect(professionalSessionStore.getAccountId()).toBe(professionalDb.professionals.find((p) => p.email === 'nova.pessoa@exemplo.ao')!.id)
  })

  it('verificar uma conta já verificada ⇒ INVALID_CODE', async () => {
    expect(await code(portal.professionalVerifyEmail(DEMO_EMAIL, CODE))).toBe('INVALID_CODE')
  })

  it('login antes de verificar ⇒ EMAIL_NOT_VERIFIED (só com a palavra-passe certa); errada ⇒ INVALID_CREDENTIALS', async () => {
    await register('nova.pessoa@exemplo.ao')
    expect(await code(portal.professionalLogin('nova.pessoa@exemplo.ao', NEW_PASSWORD))).toBe('EMAIL_NOT_VERIFIED')
    expect(await code(portal.professionalLogin('nova.pessoa@exemplo.ao', 'outra-palavra-passe'))).toBe('INVALID_CREDENTIALS')
    expect(professionalSessionStore.getAccountId()).toBeNull()
  })
})

describe('login e sessão (UC-MKT-02)', () => {
  it('credenciais erradas (palavra-passe ou e-mail desconhecido) ⇒ INVALID_CREDENTIALS', async () => {
    expect(await code(portal.professionalLogin(DEMO_EMAIL, 'errada-mesmo'))).toBe('INVALID_CREDENTIALS')
    expect(await code(portal.professionalLogin('ninguem@exemplo.ao', PASSWORD))).toBe('INVALID_CREDENTIALS')
  })

  it('o e-mail do login ignora maiúsculas e espaços', async () => {
    expect(await code(portal.professionalLogin('  PROFISSIONAL@vitafamily.app ', PASSWORD))).toBe('OK')
  })

  it('sem sessão ⇒ INVALID_CREDENTIALS, também para uma conta não verificada na sessão', async () => {
    expect(await code(portal.getProfessionalMe())).toBe('INVALID_CREDENTIALS')
    signIn('pro_inexistente')
    expect(await code(portal.getProfessionalMe())).toBe('INVALID_CREDENTIALS')
    await portal.professionalRegister({ email: 'nao.verificado@exemplo.ao', password: NEW_PASSWORD, termsVersion: '2026-11' })
    signIn(professionalDb.professionals.find((p) => p.email === 'nao.verificado@exemplo.ao')!.id)
    expect(await code(portal.getProfessionalMe())).toBe('INVALID_CREDENTIALS')
  })

  it('logout limpa a sessão', async () => {
    await portal.professionalLogin(DEMO_EMAIL, PASSWORD)
    await portal.professionalLogout()
    expect(await code(portal.getProfessionalMe())).toBe('INVALID_CREDENTIALS')
  })

  it('a recuperação de palavra-passe revoga a sessão e troca a palavra-passe', async () => {
    expect(await code(portal.professionalLogin(DEMO_EMAIL, PASSWORD))).toBe('OK')
    await portal.professionalForgotPassword(DEMO_EMAIL)
    expect(await code(portal.professionalResetPassword(DEMO_EMAIL, '000000', NEW_PASSWORD))).toBe('INVALID_CODE')
    expect(await code(portal.professionalResetPassword(DEMO_EMAIL, CODE, 'curta'))).toBe('PASSWORD_WEAK')
    expect(await code(portal.professionalResetPassword(DEMO_EMAIL, CODE, NEW_PASSWORD))).toBe('OK')
    expect(await code(portal.getProfessionalMe())).toBe('INVALID_CREDENTIALS')
    expect(await code(portal.professionalLogin(DEMO_EMAIL, PASSWORD))).toBe('INVALID_CREDENTIALS')
    expect(await code(portal.professionalLogin(DEMO_EMAIL, NEW_PASSWORD))).toBe('OK')
  })

  it('a leitura do perfil funciona em todos os estados (OP-59)', async () => {
    signIn('pro_demo')
    for (const status of ['DRAFT', 'PENDING_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const) {
      rec('pro_demo').validationStatus = status
      expect(await code(portal.getProfessionalMe())).toBe('OK')
      expect(await code(portal.listProfessionalCredentials())).toBe('OK')
    }
  })
})

// ───── Matriz de escrita por estado (authorization.md §10.2) ─────

const LOCKED = 'PROFESSIONAL_LOCKED'
const OK = 'OK'
const STATES: ProfessionalValidationStatus[] = ['DRAFT', 'PENDING_REVIEW', 'NEEDS_INFO', 'APPROVED', 'REJECTED', 'SUSPENDED']

/** Colunas na ordem de `STATES`. */
const MATRIX: Array<{ name: string; expected: string[]; run: () => Promise<unknown> }> = [
  {
    name: 'alterar displayName',
    expected: [OK, LOCKED, OK, LOCKED, LOCKED, LOCKED],
    run: () => portal.updateProfessionalMe({ displayName: 'Dra. Helena Nova' }),
  },
  {
    name: 'alterar bio',
    expected: [OK, OK, OK, OK, LOCKED, LOCKED],
    run: () => portal.updateProfessionalMe({ bio: 'Nova biografia' }),
  },
  {
    name: 'definir especialidades',
    expected: [OK, LOCKED, OK, LOCKED, LOCKED, LOCKED],
    run: () => portal.setProfessionalSpecialties(['spc_psico']),
  },
  {
    name: 'carregar credencial',
    expected: [OK, LOCKED, OK, LOCKED, LOCKED, LOCKED],
    run: () => portal.uploadProfessionalCredential({ kind: 'IDENTITY', file: pdf() }),
  },
  {
    name: 'criar oferta',
    expected: [OK, OK, OK, OK, LOCKED, LOCKED],
    run: () => portal.createProfessionalOffer({ specialtyId: 'spc_psico', method: 'VIDEO', durationMinutes: 30, priceKz: 5000 }),
  },
  {
    name: 'criar bloqueio',
    expected: [OK, OK, OK, OK, LOCKED, LOCKED],
    run: () => portal.createProfessionalTimeOff({ startsAt: inDays(30), endsAt: inDays(31) }),
  },
]

describe('matriz de escrita por estado (authorization.md §10.2)', () => {
  for (const action of MATRIX) {
    it.each(STATES.map((status, i) => [status, action.expected[i]] as const))(`${action.name} em %s ⇒ %s`, async (status, expected) => {
      const demo = rec('pro_demo')
      demo.validationStatus = status
      // Especialidade própria para que «criar oferta» falhe só pelo estado, não pela especialidade.
      demo.specialtyIds = ['spc_psico']
      signIn('pro_demo')
      expect(await code(action.run())).toBe(expected)
    })
  }
})

// ───── Perfil (UC-MKT-03) ─────

describe('perfil e especialidades (UC-MKT-03)', () => {
  it('campos inválidos ⇒ VALIDATION_ERROR; patch vazio também', async () => {
    signIn('pro_demo')
    expect(await code(portal.updateProfessionalMe({}))).toBe('VALIDATION_ERROR')
    expect(await code(portal.updateProfessionalMe({ displayName: 'A' }))).toBe('VALIDATION_ERROR')
    expect(await code(portal.updateProfessionalMe({ city: 'L' }))).toBe('VALIDATION_ERROR')
    expect(await code(portal.updateProfessionalMe({ bio: 'x'.repeat(1001) }))).toBe('VALIDATION_ERROR')
    expect(await code(portal.updateProfessionalMe({ paymentInstructions: 'x'.repeat(501) }))).toBe('VALIDATION_ERROR')
  })

  it('bio e instruções de pagamento editam-se em PENDING_REVIEW e a bio pode ser apagada com null', async () => {
    signIn('pro_fila')
    const updated = await portal.updateProfessionalMe({ paymentInstructions: 'IBAN novo', bio: null })
    expect(updated.paymentInstructions).toBe('IBAN novo')
    expect(updated.bio).toBeUndefined()
  })

  it('especialidades: 1 a 5, só ativas; as que já tinha mantêm-se', async () => {
    signIn('pro_demo')
    expect(await code(portal.setProfessionalSpecialties([]))).toBe('VALIDATION_ERROR')
    expect(await code(portal.setProfessionalSpecialties(['a', 'b', 'c', 'd', 'e', 'f']))).toBe('VALIDATION_ERROR')
    expect(await code(portal.setProfessionalSpecialties(['spc_antiga']))).toBe('VALIDATION_ERROR')
    expect(await code(portal.setProfessionalSpecialties(['spc_nao_existe']))).toBe('VALIDATION_ERROR')
    expect(await code(portal.setProfessionalSpecialties(['spc_geral', 'spc_psico']))).toBe('OK')
  })

  it('retirar uma especialidade com ofertas ⇒ CONFLICT (só possível em DRAFT/NEEDS_INFO)', async () => {
    rec('pro_aprovada').validationStatus = 'NEEDS_INFO'
    signIn('pro_aprovada')
    expect(await code(portal.setProfessionalSpecialties(['spc_treino']))).toBe('CONFLICT')
    expect(await code(portal.setProfessionalSpecialties(['spc_yoga', 'spc_treino']))).toBe('OK')
  })

  it('catálogo do portal só mostra especialidades ativas', async () => {
    signIn('pro_aprovada')
    const ids = (await portal.listProfessionalSpecialtyCatalog()).map((s) => s.id)
    expect(ids).toContain('spc_yoga')
    expect(ids).not.toContain('spc_antiga')
  })
})

// ───── Credenciais (UC-MKT-04) ─────

describe('credenciais (UC-MKT-04)', () => {
  it('tipo inválido ⇒ FILE_TYPE_NOT_ALLOWED; > 10 MB ⇒ FILE_TOO_LARGE; ficheiro vazio ⇒ VALIDATION_ERROR', async () => {
    signIn('pro_demo')
    const txt = new File(['x'], 'nota.txt', { type: 'text/plain' })
    const big = new File([new Uint8Array(CREDENTIAL_MAX_BYTES + 1)], 'grande.pdf', { type: 'application/pdf' })
    const empty = new File([], 'vazio.pdf', { type: 'application/pdf' })
    expect(await code(portal.uploadProfessionalCredential({ kind: 'IDENTITY', file: txt }))).toBe('FILE_TYPE_NOT_ALLOWED')
    expect(await code(portal.uploadProfessionalCredential({ kind: 'IDENTITY', file: big }))).toBe('FILE_TOO_LARGE')
    expect(await code(portal.uploadProfessionalCredential({ kind: 'IDENTITY', file: empty }))).toBe('VALIDATION_ERROR')
  })

  it('data de validade mal formada ⇒ VALIDATION_ERROR', async () => {
    signIn('pro_demo')
    expect(await code(portal.uploadProfessionalCredential({ kind: 'IDENTITY', file: pdf(), validUntil: '31/12/2030' }))).toBe('VALIDATION_ERROR')
  })

  it('a 11.ª credencial ⇒ LIMIT_EXCEEDED', async () => {
    signIn('pro_demo')
    for (let i = 0; i < 10; i++) {
      expect(await code(portal.uploadProfessionalCredential({ kind: 'CERTIFICATION', file: pdf(`c${i}.pdf`) }))).toBe('OK')
    }
    expect(await code(portal.uploadProfessionalCredential({ kind: 'CERTIFICATION', file: pdf() }))).toBe('LIMIT_EXCEEDED')
  })

  it('fica PENDING na primeira leitura e CLEAN na seguinte; só CLEAN se descarrega como Blob', async () => {
    signIn('pro_demo')
    const created = await portal.uploadProfessionalCredential({ kind: 'IDENTITY', file: pdf() })
    expect(created.scanStatus).toBe('PENDING')
    expect((await portal.listProfessionalCredentials())[0]?.scanStatus).toBe('PENDING')
    expect((await portal.listProfessionalCredentials())[0]?.scanStatus).toBe('CLEAN')
    const blob = await portal.downloadProfessionalCredential(created.id)
    expect(blob).toBeInstanceOf(Blob)
    expect(blob.size).toBe(100)
  })

  it('nome com "eicar" é INFECTED: não descarregável, mas pode ser removida', async () => {
    signIn('pro_demo')
    const bad = await portal.uploadProfessionalCredential({ kind: 'IDENTITY', file: pdf('eicar-teste.pdf') })
    await portal.listProfessionalCredentials()
    const after = (await portal.listProfessionalCredentials()).find((c) => c.id === bad.id)!
    expect(after.scanStatus).toBe('INFECTED')
    expect(await code(portal.deleteProfessionalCredential(bad.id))).toBe('OK')
    expect(await code(portal.downloadProfessionalCredential(bad.id))).toBe('NOT_FOUND')
  })

  // Contrato (errors.md, openapi §download): credencial não CLEAN ⇒ DOCUMENT_NOT_AVAILABLE (409).
  it('descarregar credencial PENDING ou INFECTED ⇒ DOCUMENT_NOT_AVAILABLE (contrato)', async () => {
    signIn('pro_demo')
    const pending = await portal.uploadProfessionalCredential({ kind: 'IDENTITY', file: pdf() })
    expect(await code(portal.downloadProfessionalCredential(pending.id))).toBe('DOCUMENT_NOT_AVAILABLE')
    const bad = await portal.uploadProfessionalCredential({ kind: 'CERTIFICATION', file: pdf('eicar.pdf') })
    await portal.listProfessionalCredentials()
    await portal.listProfessionalCredentials()
    expect(await code(portal.downloadProfessionalCredential(bad.id))).toBe('DOCUMENT_NOT_AVAILABLE')
  })

  it('a resposta nunca inclui o nome do ficheiro', async () => {
    signIn('pro_demo')
    const created = await portal.uploadProfessionalCredential({ kind: 'IDENTITY', file: pdf('nome-privado.pdf') })
    expect(Object.keys(created)).not.toContain('fileName')
    expect(Object.keys(created)).not.toContain('ticks')
  })
})

// ───── Isolamento entre profissionais ─────

describe('isolamento: recursos de outro profissional ⇒ NOT_FOUND', () => {
  it('credenciais, ofertas, regras e bloqueios', async () => {
    signIn('pro_aprovada')
    const rule = (await portal.createProfessionalScheduleRule({ offerId: 'ofr_ap_1', weekdays: [1], startTime: '09:00', endTime: '10:00' })).rule
    const timeOff = await portal.createProfessionalTimeOff({ startsAt: inDays(40), endsAt: inDays(41) })

    signIn('pro_demo')
    expect(await code(portal.downloadProfessionalCredential('crd_ap_id'))).toBe('NOT_FOUND')
    expect(await code(portal.deleteProfessionalCredential('crd_ap_id'))).toBe('NOT_FOUND')
    expect(await code(portal.updateProfessionalOffer('ofr_ap_1', { priceKz: 1 }))).toBe('NOT_FOUND')
    expect(await code(portal.updateProfessionalScheduleRule(rule.id, { active: false }))).toBe('NOT_FOUND')
    expect(await code(portal.createProfessionalScheduleRule({ offerId: 'ofr_ap_1', weekdays: [1], startTime: '09:00', endTime: '10:00' }))).toBe(
      'NOT_FOUND',
    )
    expect(await code(portal.deleteProfessionalTimeOff(timeOff.id))).toBe('NOT_FOUND')
    // Os horários de outro profissional não aparecem na lista própria.
    expect(await portal.listProfessionalSlots(inDays(0), inDays(14))).toHaveLength(0)
  })
})

// ───── Ofertas (UC-MKT-08) ─────

describe('ofertas e preços (UC-MKT-08)', () => {
  const yoga = { specialtyId: 'spc_yoga', method: 'IN_PERSON' as OfferMethod, durationMinutes: 60 as OfferDuration, priceKz: 15000 }

  it('duplicado ativo (especialidade, método, duração) ⇒ CONFLICT; outro método é aceite', async () => {
    signIn('pro_aprovada')
    expect(await code(portal.createProfessionalOffer(yoga))).toBe('CONFLICT')
    expect(await code(portal.createProfessionalOffer({ ...yoga, method: 'VIDEO' }))).toBe('OK')
  })

  it('preço não inteiro ou negativo ⇒ VALIDATION_ERROR', async () => {
    signIn('pro_aprovada')
    expect(await code(portal.createProfessionalOffer({ ...yoga, method: 'CHAT', priceKz: 1500.5 }))).toBe('VALIDATION_ERROR')
    expect(await code(portal.createProfessionalOffer({ ...yoga, method: 'CHAT', priceKz: -1 }))).toBe('VALIDATION_ERROR')
    expect(await code(portal.createProfessionalOffer({ ...yoga, method: 'CHAT', priceKz: 0 }))).toBe('OK')
  })

  it('especialidade que não é do profissional ⇒ VALIDATION_ERROR; duração fora da lista ⇒ VALIDATION_ERROR', async () => {
    signIn('pro_aprovada')
    expect(await code(portal.createProfessionalOffer({ ...yoga, specialtyId: 'spc_nutri', method: 'PHONE' }))).toBe('VALIDATION_ERROR')
    expect(await code(portal.createProfessionalOffer({ ...yoga, method: 'PHONE', durationMinutes: 25 as OfferDuration }))).toBe('VALIDATION_ERROR')
  })

  it('21.ª oferta ativa ⇒ LIMIT_EXCEEDED', async () => {
    const pro = rec('pro_aprovada')
    pro.specialtyIds = ['spc_yoga', 'spc_treino']
    signIn('pro_aprovada')
    const methods: OfferMethod[] = ['IN_PERSON', 'VIDEO', 'CHAT', 'PHONE']
    const durations: OfferDuration[] = [15, 20, 30, 45, 60]
    for (const method of methods) {
      for (const durationMinutes of durations) {
        if (method === 'IN_PERSON' && durationMinutes === 60) continue // já existe, ativa
        await portal.createProfessionalOffer({ specialtyId: 'spc_yoga', method, durationMinutes, priceKz: 1000 })
      }
    }
    expect(pro.offers.filter((o) => o.active)).toHaveLength(20)
    expect(await code(portal.createProfessionalOffer({ specialtyId: 'spc_treino', method: 'IN_PERSON', durationMinutes: 60, priceKz: 1000 }))).toBe(
      'LIMIT_EXCEEDED',
    )
  })

  it('desativar remove os horários futuros livres gerados pela oferta', async () => {
    signIn('pro_aprovada')
    await portal.createProfessionalScheduleRule({ offerId: 'ofr_ap_1', weekdays: ALL_DAYS, startTime: '09:00', endTime: '10:00' })
    expect((await portal.listProfessionalSlots(inDays(0), inDays(14))).length).toBeGreaterThan(0)
    await portal.updateProfessionalOffer('ofr_ap_1', { active: false })
    expect(await portal.listProfessionalSlots(inDays(0), inDays(14))).toHaveLength(0)
  })

  it('reativar uma oferta que colide com outra ativa ⇒ CONFLICT', async () => {
    signIn('pro_aprovada')
    await portal.updateProfessionalOffer('ofr_ap_1', { active: false })
    expect(await code(portal.createProfessionalOffer(yoga))).toBe('OK')
    expect(await code(portal.updateProfessionalOffer('ofr_ap_1', { active: true }))).toBe('CONFLICT')
  })

  it('alterar preço em REJECTED ⇒ PROFESSIONAL_LOCKED; ler continua possível', async () => {
    signIn('pro_aprovada')
    rec('pro_aprovada').validationStatus = 'REJECTED'
    expect(await code(portal.updateProfessionalOffer('ofr_ap_1', { priceKz: 20000 }))).toBe(LOCKED)
    expect(await code(portal.listProfessionalOffers())).toBe('OK')
  })
})

// ───── Regras de horário (UC-MKT-09) ─────

describe('regras de horário (UC-MKT-09)', () => {
  const rule = (overrides: Partial<Parameters<typeof portal.createProfessionalScheduleRule>[0]> = {}) => ({
    offerId: 'ofr_ap_1',
    weekdays: ALL_DAYS,
    startTime: '09:00',
    endTime: '10:00',
    ...overrides,
  })

  it('a geração usa as horas de Luanda (09:00 local = 08:00 UTC) e respeita a duração', async () => {
    signIn('pro_aprovada')
    const result = await portal.createProfessionalScheduleRule(rule())
    expect(result.generation.created).toBeGreaterThan(0)
    const slots = await portal.listProfessionalSlots(inDays(0), inDays(14))
    expect(slots.length).toBeGreaterThan(0)
    for (const slot of slots) {
      expect(slot.offerId).toBe('ofr_ap_1')
      expect(new Date(slot.startsAt).toISOString().slice(11, 16)).toBe('08:00')
      expect(Date.parse(slot.endsAt) - Date.parse(slot.startsAt)).toBe(60 * 60_000)
    }
  })

  it('sobreposição com outra regra ativa ⇒ CONFLICT; dias distintos já não colidem', async () => {
    signIn('pro_aprovada')
    await portal.createProfessionalScheduleRule(rule({ weekdays: [1, 2], startTime: '09:00', endTime: '12:00' }))
    expect(await code(portal.createProfessionalScheduleRule(rule({ weekdays: [2, 3], startTime: '10:00', endTime: '11:00' })))).toBe('CONFLICT')
    expect(await code(portal.createProfessionalScheduleRule(rule({ weekdays: [4], startTime: '10:00', endTime: '11:00' })))).toBe('OK')
  })

  it('intervalo menor que a duração da oferta ⇒ VALIDATION_ERROR', async () => {
    signIn('pro_aprovada')
    expect(await code(portal.createProfessionalScheduleRule(rule({ startTime: '09:00', endTime: '09:30' })))).toBe('VALIDATION_ERROR')
    expect(await code(portal.createProfessionalScheduleRule(rule({ weekdays: [0 as Weekday] })))).toBe('VALIDATION_ERROR')
  })

  it('oferta inexistente ⇒ NOT_FOUND', async () => {
    signIn('pro_aprovada')
    expect(await code(portal.createProfessionalScheduleRule(rule({ offerId: 'ofr_nao_existe' })))).toBe('NOT_FOUND')
  })

  it('só gera horários se APPROVED: em PENDING_REVIEW a regra fica guardada e não gera nada', async () => {
    signIn('pro_fila')
    const offer = await portal.createProfessionalOffer({ specialtyId: 'spc_psico', method: 'VIDEO', durationMinutes: 30, priceKz: 5000 })
    const result = await portal.createProfessionalScheduleRule(rule({ offerId: offer.id, startTime: '09:00', endTime: '10:00' }))
    expect(result.generation.created).toBe(0)
    expect(await portal.listProfessionalSlots(inDays(0), inDays(14))).toHaveLength(0)
  })

  it('repetir a geração não duplica: a segunda devolve created 0 e os mesmos horários como unchanged', async () => {
    signIn('pro_aprovada')
    const first = await portal.createProfessionalScheduleRule(rule())
    const second = await portal.updateProfessionalScheduleRule(first.rule.id, { active: true })
    expect(second.generation.created).toBe(0)
    expect(second.generation.unchanged).toBe(first.generation.created)
    expect(await portal.listProfessionalSlots(inDays(0), inDays(57))).toHaveLength(first.generation.created)
  })

  it('desativar a regra remove os horários futuros livres que gerou', async () => {
    signIn('pro_aprovada')
    const created = await portal.createProfessionalScheduleRule(rule())
    const off = await portal.updateProfessionalScheduleRule(created.rule.id, { active: false })
    expect(off.generation.removed).toBe(created.generation.created)
    expect(await portal.listProfessionalSlots(inDays(0), inDays(14))).toHaveLength(0)
  })
})

// ───── Bloqueios (UC-MKT-09) ─────

describe('bloqueios e férias (UC-MKT-09)', () => {
  it('fim ≤ início, passado ou > 366 dias ⇒ VALIDATION_ERROR', async () => {
    signIn('pro_aprovada')
    expect(await code(portal.createProfessionalTimeOff({ startsAt: inDays(5), endsAt: inDays(5) }))).toBe('VALIDATION_ERROR')
    expect(await code(portal.createProfessionalTimeOff({ startsAt: inDays(6), endsAt: inDays(5) }))).toBe('VALIDATION_ERROR')
    expect(await code(portal.createProfessionalTimeOff({ startsAt: inDays(-10), endsAt: inDays(-9) }))).toBe('VALIDATION_ERROR')
    expect(await code(portal.createProfessionalTimeOff({ startsAt: inDays(1), endsAt: inDays(400) }))).toBe('VALIDATION_ERROR')
  })

  it('sobreposição com outro bloqueio ⇒ CONFLICT', async () => {
    signIn('pro_aprovada')
    await portal.createProfessionalTimeOff({ startsAt: inDays(10), endsAt: inDays(12) })
    expect(await code(portal.createProfessionalTimeOff({ startsAt: inDays(11), endsAt: inDays(13) }))).toBe('CONFLICT')
  })

  it('o bloqueio remove os horários livres do intervalo; apagá-lo repõe-nos', async () => {
    signIn('pro_aprovada')
    await portal.createProfessionalScheduleRule({ offerId: 'ofr_ap_1', weekdays: ALL_DAYS, startTime: '09:00', endTime: '10:00' })
    const before = await portal.listProfessionalSlots(inDays(0), inDays(14))
    const target = before[0]!
    const timeOff = await portal.createProfessionalTimeOff({ startsAt: target.startsAt, endsAt: target.endsAt })
    const during = await portal.listProfessionalSlots(inDays(0), inDays(14))
    expect(during).toHaveLength(before.length - 1)
    expect(during.some((s) => s.startsAt === target.startsAt)).toBe(false)

    await portal.deleteProfessionalTimeOff(timeOff.id)
    const restored = await portal.listProfessionalSlots(inDays(0), inDays(14))
    expect(restored).toHaveLength(before.length)
    expect(restored.some((s) => s.startsAt === target.startsAt)).toBe(true)
  })
})

// ───── Submissão (UC-MKT-05) ─────

describe('submissão para validação (UC-MKT-05)', () => {
  it('faltam requisitos ⇒ VALIDATION_ERROR (perfil de demonstração vazio)', async () => {
    signIn('pro_demo')
    expect(await code(portal.submitProfessionalForReview())).toBe('VALIDATION_ERROR')
    const { requirements } = await portal.getProfessionalMe()
    expect(requirements.canSubmit).toBe(false)
    expect(requirements.missing).toEqual(expect.arrayContaining(['CITY', 'SPECIALTY']))
  })

  it('credencial ainda em verificação bloqueia a submissão (CREDENTIAL_SCAN_PENDING)', async () => {
    signIn('pro_demo')
    await portal.updateProfessionalMe({ city: 'Luanda' })
    await portal.setProfessionalSpecialties(['spc_psico'])
    await portal.uploadProfessionalCredential({ kind: 'IDENTITY', file: pdf() })
    await portal.uploadProfessionalCredential({ kind: 'PROFESSIONAL_LICENSE', file: pdf('licenca.pdf') })
    expect((await portal.getProfessionalMe()).requirements.missing).toContain('CREDENTIAL_SCAN_PENDING')
    expect(await code(portal.submitProfessionalForReview())).toBe('VALIDATION_ERROR')
  })

  it('com requisitos cumpridos submete ⇒ PENDING_REVIEW, com histórico e bloqueio de identidade', async () => {
    signIn('pro_demo')
    await portal.updateProfessionalMe({ city: 'Luanda' })
    await portal.setProfessionalSpecialties(['spc_psico'])
    await portal.uploadProfessionalCredential({ kind: 'IDENTITY', file: pdf() })
    await portal.uploadProfessionalCredential({ kind: 'PROFESSIONAL_LICENSE', file: pdf('licenca.pdf') })
    await portal.listProfessionalCredentials()
    await portal.listProfessionalCredentials()

    const submitted = await portal.submitProfessionalForReview()
    expect(submitted.validationStatus).toBe('PENDING_REVIEW')
    expect(submitted.submittedAt).toBeDefined()
    expect(rec('pro_demo').history.at(-1)).toMatchObject({ action: 'SUBMITTED', fromStatus: 'DRAFT', toStatus: 'PENDING_REVIEW' })
    expect(await code(portal.setProfessionalSpecialties(['spc_geral']))).toBe(LOCKED)
    expect(await code(portal.submitProfessionalForReview())).toBe('INVALID_STATE_TRANSITION')
  })

  it('submeter em PENDING_REVIEW ou APPROVED ⇒ INVALID_STATE_TRANSITION', async () => {
    signIn('pro_fila')
    expect(await code(portal.submitProfessionalForReview())).toBe('INVALID_STATE_TRANSITION')
    signIn('pro_aprovada')
    expect(await code(portal.submitProfessionalForReview())).toBe('INVALID_STATE_TRANSITION')
  })
})
