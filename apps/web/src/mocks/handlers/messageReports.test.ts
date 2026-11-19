import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_PASSWORD } from '../data/users'
import { resetMarketplaceDb } from '../marketplaceDb'
import { resetProfessionalDb } from '../professionalDb'
import * as admin from './messageReports'
import * as ms from './messaging'
import * as portal from './professionalPortal'

const F = 'fam_monarca'
const U = 'usr_monarca'
const ME = 'mem_monarca'

const SEED_REPORT = 'rep_seed_1'
const SEED_TEXT = 'Posso também fazer uma conversa curta de 15 minutos para nos conhecermos.'

beforeEach(() => {
  resetMarketplaceDb()
  resetProfessionalDb()
  window.sessionStorage.clear()
})

async function messageId(conversationId: string, seq: number) {
  const page = await ms.listFamilyMessages(F, U, ME, conversationId)
  return page.items.find((m) => m.seq === seq)!.id
}

// ───── Fila ─────

describe('fila de denúncias (admin)', () => {
  it('lista OPEN com o seed; o item não traz o texto da mensagem nem dados de família', async () => {
    const page = await admin.adminListMessageReports()
    expect(page.items.map((i) => i.id)).toEqual([SEED_REPORT])

    const item = page.items[0]!
    expect(item).toMatchObject({
      status: 'OPEN',
      reason: 'SCAM_OR_OFF_PLATFORM_PAYMENT',
      reportedSide: 'PROFESSIONAL',
      professionalId: 'pro_pub_psico1',
      professionalDisplayName: 'Dra. Teresa Neto',
    })
    expect(item).not.toHaveProperty('message')
    expect(item).not.toHaveProperty('text')
    expect(JSON.stringify(page)).not.toContain(SEED_TEXT)
    for (const key of ['familyId', 'memberId', 'participantLabel', 'reportedUserId']) {
      expect(item).not.toHaveProperty(key)
    }
  })

  it('uma denúncia nova (família denuncia mensagem do profissional) aparece na fila', async () => {
    const msg2 = await messageId('cnv_seed_1', 2)
    const receipt = await ms.reportFamilyMessage(F, U, ME, 'cnv_seed_1', msg2, { reason: 'SPAM' })

    const page = await admin.adminListMessageReports()
    expect(page.items.map((i) => i.id).sort()).toEqual([SEED_REPORT, receipt.id].sort())
    expect(page.items.find((i) => i.id === receipt.id)).toMatchObject({ reason: 'SPAM', reportedSide: 'PROFESSIONAL', status: 'OPEN' })
  })
})

// ───── Detalhe ─────

describe('detalhe da denúncia (admin)', () => {
  it('message.text e contextBefore com até 2 mensagens anteriores por seq crescente', async () => {
    const detail = await admin.adminGetMessageReport(SEED_REPORT)
    expect(detail.message.text).toBe(SEED_TEXT)
    expect(detail.contextBefore.map((m) => m.seq)).toEqual([1, 2])
    expect(detail.contextBefore[0]?.text).toBe('Bom dia. Têm disponibilidade para uma primeira consulta online?')
    expect(detail.contextBefore[1]?.text).toBe('Bom dia! Sim, tenho horários esta semana. Prefere de manhã ou à tarde?')
    expect(detail.professional).toEqual({ id: 'pro_pub_psico1', displayName: 'Dra. Teresa Neto', city: 'Luanda' })
  })

  it('sem chaves de família, membro, participantLabel nem utilizador', async () => {
    const detail = await admin.adminGetMessageReport(SEED_REPORT)
    for (const key of ['familyId', 'memberId', 'participantLabel']) {
      expect(detail).not.toHaveProperty(key)
    }
    const json = JSON.stringify(detail)
    for (const secret of ['fam_monarca', 'mem_monarca', 'usr_monarca', 'Monarca']) {
      expect(json).not.toContain(secret)
    }
  })

  it('reportedUserId só quando o lado denunciado é a família', async () => {
    const seedDetail = await admin.adminGetMessageReport(SEED_REPORT)
    expect(seedDetail.reportedSide).toBe('PROFESSIONAL')
    expect(seedDetail.reportedUserId).toBeUndefined()

    await portal.professionalLogin('marta.lopes@exemplo.ao', DEMO_PASSWORD)
    const familyMsg = await ms.listProfessionalMessages('cnv_seed_4')
    const seq2 = familyMsg.items.find((m) => m.seq === 2)!.id
    const receipt = await ms.reportProfessionalMessage('cnv_seed_4', seq2, { reason: 'ABUSE' })

    const detail = await admin.adminGetMessageReport(receipt.id)
    expect(detail.reportedSide).toBe('FAMILY')
    expect(detail.reportedUserId).toBe(U)
    expect(detail.professional).toEqual({ id: 'pro_aprovada', displayName: 'Marta Lopes', city: 'Benguela' })
    expect(detail.contextBefore.map((m) => m.seq)).toEqual([1])
  })

  it('uma mensagem anterior já oculta vem sem texto no contexto', async () => {
    const msg2 = await messageId('cnv_seed_1', 2)
    const receipt = await ms.reportFamilyMessage(F, U, ME, 'cnv_seed_1', msg2, { reason: 'SPAM' })
    await admin.adminDecideMessageReport(receipt.id, 'HIDE_MESSAGE')

    const detail = await admin.adminGetMessageReport(SEED_REPORT)
    const hiddenBefore = detail.contextBefore.find((m) => m.seq === 2)!
    expect(hiddenBefore.hidden).toBe(true)
    expect(hiddenBefore.text).toBeUndefined()
    expect(detail.contextBefore.find((m) => m.seq === 1)?.text).toBeDefined()
  })

  it('id inexistente ⇒ NOT_FOUND (detalhe e decisão)', async () => {
    await expect(admin.adminGetMessageReport('rep_nao_existe')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(admin.adminDecideMessageReport('rep_nao_existe', 'DISMISS')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// ───── Decisões ─────

describe('decisão da denúncia (admin)', () => {
  it('DISMISS arquiva a denúncia e a mensagem continua visível para a família', async () => {
    const decided = await admin.adminDecideMessageReport(SEED_REPORT, 'DISMISS')
    expect(decided).toMatchObject({ status: 'DECIDED', decision: 'DISMISS' })
    expect(decided.decidedAt).toEqual(expect.any(String))

    expect((await admin.adminListMessageReports()).items).toEqual([])
    const decidedList = await admin.adminListMessageReports({ status: 'DECIDED' })
    expect(decidedList.items.map((i) => i.id)).toEqual([SEED_REPORT])

    const family = await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')
    const seq3 = family.items.find((m) => m.seq === 3)!
    expect(seq3).toMatchObject({ hidden: false, text: SEED_TEXT })
    expect((await ms.getFamilyConversation(F, U, ME, 'cnv_seed_1')).status).toBe('OPEN')
  })

  it('HIDE_MESSAGE oculta: a família vê hidden true e text undefined; o admin mantém o texto original', async () => {
    const decided = await admin.adminDecideMessageReport(SEED_REPORT, 'HIDE_MESSAGE')
    expect(decided).toMatchObject({ status: 'DECIDED', decision: 'HIDE_MESSAGE' })
    expect(decided.message).toMatchObject({ text: SEED_TEXT, hidden: true })

    const family = await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')
    const seq3 = family.items.find((m) => m.seq === 3)!
    expect(seq3.hidden).toBe(true)
    expect(seq3.text).toBeUndefined()

    const adminView = await admin.adminGetMessageReport(SEED_REPORT)
    expect(adminView.message.text).toBe(SEED_TEXT)
    expect((await ms.getFamilyConversation(F, U, ME, 'cnv_seed_1')).status).toBe('OPEN')
  })

  it('HIDE_AND_CLOSE fecha a conversa (closedBy SYSTEM); a família não a reabre', async () => {
    await admin.adminDecideMessageReport(SEED_REPORT, 'HIDE_AND_CLOSE')

    const conv = await ms.getFamilyConversation(F, U, ME, 'cnv_seed_1')
    expect(conv).toMatchObject({ status: 'CLOSED', closedBy: 'SYSTEM', canSend: false })
    await expect(ms.reopenFamilyConversation(F, U, ME, 'cnv_seed_1')).rejects.toMatchObject({ code: 'CONVERSATION_CLOSED' })
    await expect(ms.sendFamilyMessage(F, U, ME, 'cnv_seed_1', { text: 'Olá' })).rejects.toMatchObject({ code: 'CONVERSATION_CLOSED' })
  })

  it('decidir duas vezes ⇒ INVALID_STATE_TRANSITION', async () => {
    await admin.adminDecideMessageReport(SEED_REPORT, 'DISMISS')
    await expect(admin.adminDecideMessageReport(SEED_REPORT, 'HIDE_MESSAGE')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
  })
})
