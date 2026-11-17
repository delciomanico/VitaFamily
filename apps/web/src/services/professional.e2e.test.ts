// @vitest-environment node
/*
 * Ponto-a-ponto dos serviços do profissional/admin do web contra a **API real** (MK1).
 * Só corre com `VITE_E2E_MAIL_LOG` (ficheiro onde um sumidouro SMTP guarda os e-mails), `VITE_E2E_ADMIN_EMAIL` e
 * `VITE_E2E_ADMIN_PASSWORD` (conta já promovida a Platform Admin) e `VITE_API_URL`; caso contrário é ignorado.
 * Ver docs/11-implementation/plan.md (MK1, ligação do web à API).
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { authService } from './auth.service'
import { professionalAdminService } from './professionalAdmin.service'
import { PROFESSIONAL_TERMS_VERSION, professionalPortalService as portal } from './professionalPortal.service'
import { setProfessionalAccessToken } from '@/lib/professionalApiClient'
import { setAccessToken } from '@/lib/apiClient'
import { AppError } from '@/lib/errors'

const env = import.meta.env as Record<string, string | undefined>
const MAIL_LOG = env.VITE_E2E_MAIL_LOG
const ADMIN_EMAIL = env.VITE_E2E_ADMIN_EMAIL ?? ''
const ADMIN_PASSWORD = env.VITE_E2E_ADMIN_PASSWORD ?? ''
const enabled = Boolean(MAIL_LOG && ADMIN_EMAIL && env.VITE_API_URL)

// O `fetch` do Node não tem jar de cookies: guarda-se o `Set-Cookie` por nome e reenvia-se (como o browser).
const jar = new Map<string, string>()
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers)
  const url = String(input)
  // Respeita o caminho do cookie, como o browser: `professional_refresh_token` só em /professional-portal/auth.
  const cookies = [...jar.entries()]
    .filter(([name]) => (name === 'professional_refresh_token' ? url.includes('/professional-portal/auth') : name === 'refresh_token' ? url.includes('/api/v1/auth') : true))
    .map(([name, value]) => `${name}=${value}`)
  if (cookies.length > 0) headers.set('Cookie', cookies.join('; '))
  const res = await realFetch(input, { ...init, headers })
  for (const line of res.headers.getSetCookie()) {
    const [pair = ''] = line.split(';')
    const [name = '', ...rest] = pair.split('=')
    const value = rest.join('=')
    if (value === '' || /max-age=0/i.test(line)) jar.delete(name.trim())
    else jar.set(name.trim(), value)
  }
  return res
}) as typeof fetch

function lastCode(to: string): string {
  const blocks = readFileSync(MAIL_LOG as string, 'utf8').split('\n=====\n').filter((b: string) => b.toLowerCase().includes(`to: ${to}`))
  const text = blocks.at(-1) ?? ''
  const match = /\b(\d{6})\b/.exec(text.replace(/=\r?\n/g, ''))
  if (!match?.[1]) throw new Error(`sem código no e-mail para ${to}`)
  return match[1]
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(error, `esperado erro ${code}`).toBeInstanceOf(AppError)
  expect((error as AppError).code).toBe(code)
}

const pdf = () => new File([new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')], 'doc.pdf', { type: 'application/pdf' })

describe.skipIf(!enabled)('portal do profissional + admin contra a API real', () => {
  const email = `pro-${Date.now()}@e2e.test`
  const password = 'ProPassw0rd-e2e!x'
  let specialtyId = ''
  let professionalId = ''
  let offerId = ''

  it('admin: login e criação de especialidade no catálogo', async () => {
    await authService.login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    const created = await professionalAdminService.createSpecialty({ name: `Clínica geral ${Date.now()}`, category: 'HEALTH' })
    specialtyId = created.id
    expect(created.active).toBe(true)
    expect((await professionalAdminService.listSpecialties()).some((s) => s.id === specialtyId)).toBe(true)
  })

  it('registo -> verificar e-mail -> login', async () => {
    await portal.register({ email, password })
    await expectCode(portal.login(email, password), 'EMAIL_NOT_VERIFIED')
    await portal.verifyEmail(email, lastCode(email))
    await expectCode(portal.login(email, 'palavra-errada-12345'), 'INVALID_CREDENTIALS')
    const session = await portal.login(email, password)
    professionalId = session.professionalId
    expect(session).toMatchObject({ email, validationStatus: 'DRAFT' })
    expect(PROFESSIONAL_TERMS_VERSION).toBeTruthy()
  })

  it('perfil e especialidades', async () => {
    const me = await portal.getMe()
    expect(me.id).toBe(professionalId)
    expect(me.requirements.canSubmit).toBe(false)
    expect(me.requirements.missing).toContain('DISPLAY_NAME')
    expect(me.displayName).toBeUndefined() // null da API -> ausente na UI
    await portal.updateMe({ displayName: 'Dra. Teste E2E', city: 'Luanda', bio: 'Bio', paymentInstructions: 'Transferência' })
    expect((await portal.listSpecialtyCatalog()).some((s) => s.id === specialtyId)).toBe(true)
    const updated = await portal.setSpecialties([specialtyId])
    expect(updated.specialties.map((s) => s.id)).toEqual([specialtyId])
    expect(updated.displayName).toBe('Dra. Teste E2E')
  })

  it('credenciais (multipart), antivírus, descarga e remoção', async () => {
    const identity = await portal.uploadCredential({ kind: 'IDENTITY', file: pdf() })
    expect(identity.scanStatus).toBe('PENDING')
    await expectCode(portal.downloadCredential(identity.id), 'DOCUMENT_NOT_AVAILABLE')
    const license = await portal.uploadCredential({
      kind: 'PROFESSIONAL_LICENSE',
      number: 'OM-123',
      issuingBody: 'Ordem dos Médicos',
      validUntil: '2030-12-31',
      file: pdf(),
    })
    expect(license).toMatchObject({ number: 'OM-123', validUntil: '2030-12-31', contentType: 'application/pdf' })
    const extra = await portal.uploadCredential({ kind: 'CERTIFICATION', file: pdf() })
    await portal.deleteCredential(extra.id)
    await expectCode(
      portal.uploadCredential({ kind: 'CERTIFICATION', file: new File([new TextEncoder().encode('MZ-not-a-document')], 'x.exe', { type: 'application/x-msdownload' }) }),
      'FILE_TYPE_NOT_ALLOWED',
    )
    // O worker analisa de forma assíncrona.
    let list = await portal.listCredentials()
    for (let i = 0; i < 30 && list.some((c) => c.scanStatus === 'PENDING'); i++) {
      await new Promise((r) => setTimeout(r, 1000))
      list = await portal.listCredentials()
    }
    expect(list.map((c) => c.scanStatus)).toEqual(['CLEAN', 'CLEAN'])
    const blob = await portal.downloadCredential(identity.id)
    expect(blob.size).toBeGreaterThan(10)
  })

  it('submissão, bloqueio de escrita e decisão do admin', async () => {
    const submitted = await portal.submit()
    expect(submitted.validationStatus).toBe('PENDING_REVIEW')
    await expectCode(portal.updateMe({ displayName: 'Outro nome' }), 'PROFESSIONAL_LOCKED')
    await expectCode(portal.submit(), 'CONFLICT') // INVALID_STATE_TRANSITION -> CONFLICT na UI

    const page = await professionalAdminService.list({ status: 'PENDING_REVIEW' })
    expect(page.items.some((i) => i.id === professionalId)).toBe(true)
    const detail = await professionalAdminService.get(professionalId)
    expect(detail.credentials).toHaveLength(2)
    expect(detail).not.toHaveProperty('paymentInstructions')
    expect((await professionalAdminService.downloadCredential(professionalId, detail.credentials[0]!.id)).size).toBeGreaterThan(10)
    await expectCode(professionalAdminService.decide(professionalId, { decision: 'REJECT' }), 'VALIDATION_ERROR')
    const decided = await professionalAdminService.decide(professionalId, { decision: 'APPROVE' })
    expect(decided.validationStatus).toBe('APPROVED')
    expect(decided.history[0]?.action).toBe('APPROVED')
    expect((await portal.getMe()).validationStatus).toBe('APPROVED')
  })

  it('oferta, regra de horário (gera horários), folga e especialidade duplicada', async () => {
    const offer = await portal.createOffer({ specialtyId, method: 'IN_PERSON', durationMinutes: 30, priceKz: 15000, note: 'Rua X' })
    offerId = offer.id
    expect(offer.active).toBe(true)
    await expectCode(portal.createOffer({ specialtyId, method: 'IN_PERSON', durationMinutes: 30, priceKz: 9000 }), 'CONFLICT')
    expect((await portal.updateOffer(offerId, { priceKz: 16000 })).priceKz).toBe(16000)
    expect((await portal.listOffers(true)).map((o) => o.id)).toContain(offerId)

    const result = await portal.createScheduleRule({ offerId, weekdays: [1, 2, 3, 4, 5, 6, 7], startTime: '09:00', endTime: '12:00' })
    expect(result.generation.created).toBeGreaterThan(0)
    expect(result.rule.validFrom).toBeUndefined()
    expect((await portal.listScheduleRules({ offerId })).length).toBe(1)
    const from = new Date()
    const to = new Date(from.getTime() + 3 * 86_400_000)
    const slots = await portal.listSlots(from.toISOString(), to.toISOString())
    expect(slots.length).toBeGreaterThan(0)
    expect(slots[0]).toHaveProperty('endsAt')

    const off = await portal.createTimeOff({ startsAt: new Date(to.getTime() + 86_400_000).toISOString(), endsAt: new Date(to.getTime() + 2 * 86_400_000).toISOString(), reason: 'Férias' })
    expect((await portal.listTimeOff()).map((t) => t.id)).toContain(off.id)
    await portal.deleteTimeOff(off.id)

    const name = `Duplicada ${Date.now()}`
    await professionalAdminService.createSpecialty({ name, category: 'WELLNESS' })
    await expectCode(professionalAdminService.createSpecialty({ name, category: 'WELLNESS' }), 'CONFLICT')
  })

  it('sessão: restore por cookie (X-Requested-With) e logout', async () => {
    setProfessionalAccessToken(null) // simula recarregar a página: só resta o cookie
    const restored = await portal.restore()
    expect(restored).toMatchObject({ professionalId, email, validationStatus: 'APPROVED' })
    expect((await portal.getMe()).email).toBe(email)
    await portal.logout()
    expect(await portal.restore()).toBeNull()
    setAccessToken(null)
  })
})
