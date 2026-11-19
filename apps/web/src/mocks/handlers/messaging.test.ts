import { beforeEach, describe, expect, it } from 'vitest'
import { professionalSessionStore } from '@/lib/storage'
import { DEMO_PASSWORD } from '../data/users'
import { db } from '../db'
import { resetMarketplaceDb } from '../marketplaceDb'
import { resetProfessionalDb } from '../professionalDb'
import * as ms from './messaging'
import * as portal from './professionalPortal'

const F = 'fam_monarca'
const U = 'usr_monarca'
const ME = 'mem_monarca'

const startInput = (professionalId: string, extra: { text?: string; participantLabel?: string; clientMessageId?: string } = {}) => ({
  professionalId,
  participantLabel: extra.participantLabel ?? 'Monarca',
  text: extra.text ?? 'Bom dia, têm disponibilidade?',
  clientMessageId: extra.clientMessageId,
})

beforeEach(() => {
  resetMarketplaceDb()
  resetProfessionalDb()
  window.sessionStorage.clear()
})

// ───── Lado da família: elegibilidade (requireMessaging) ─────

describe('elegibilidade para conversar (MESSAGE_PROFESSIONALS)', () => {
  it('outro adulto com conta (mem_ana) ⇒ FORBIDDEN', async () => {
    await expect(ms.listFamilyConversations(F, U, 'mem_ana')).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(ms.startFamilyConversation(F, U, 'mem_ana', startInput('pro_pub_psico1'))).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('membro inexistente ⇒ NOT_FOUND; família alheia ⇒ NOT_FOUND', async () => {
    await expect(ms.listFamilyConversations(F, U, 'mem_inexistente')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(ms.listFamilyConversations('fam_outra', U, ME)).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('membro que existe mas noutra família ⇒ NOT_FOUND', async () => {
    const ana = db.members.find((m) => m.id === 'mem_ana')!
    const outro = { ...ana, id: 'mem_outra_familia', familyId: 'fam_outra', userId: undefined }
    db.members.push(outro)
    try {
      await expect(ms.listFamilyConversations(F, U, 'mem_outra_familia')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    } finally {
      db.members.splice(db.members.indexOf(outro), 1)
    }
  })

  it('tutelado (mem_pedro) pode ver as conversas; lista só as do membro pedido', async () => {
    const page = await ms.listFamilyConversations(F, U, 'mem_pedro')
    expect(page.items.map((c) => c.id)).toEqual(['cnv_seed_2'])
    const monarca = await ms.listFamilyConversations(F, U, ME)
    expect(monarca.items.map((c) => c.id).sort()).toEqual(['cnv_seed_1', 'cnv_seed_3', 'cnv_seed_4'])
  })

  it('filtro por estado status=CLOSED', async () => {
    const page = await ms.listFamilyConversations(F, U, ME, { status: 'CLOSED' })
    expect(page.items).toEqual([])
    const pedro = await ms.listFamilyConversations(F, U, 'mem_pedro', { status: 'CLOSED' })
    expect(pedro.items.map((c) => c.id)).toEqual(['cnv_seed_2'])
  })
})

// ───── Iniciar conversa ─────

describe('iniciar conversa (família)', () => {
  it('cria a conversa (created true) e com a mesma conversa aberta acrescenta mensagem (created false)', async () => {
    const first = await ms.startFamilyConversation(F, U, ME, startInput('pro_pub_psico2'))
    expect(first.created).toBe(true)
    expect(first.conversation.professional.id).toBe('pro_pub_psico2')
    expect(first.conversation.canSend).toBe(true)
    expect(first.message).toMatchObject({ seq: 1, mine: true, side: 'FAMILY', hidden: false })

    const second = await ms.startFamilyConversation(F, U, ME, startInput('pro_pub_psico2', { text: 'Segunda mensagem' }))
    expect(second.created).toBe(false)
    expect(second.conversation.id).toBe(first.conversation.id)
    expect(second.message.seq).toBe(2)
  })

  it('com o mesmo clientMessageId é idempotente (mesma mensagem, sem duplicar)', async () => {
    const a = await ms.startFamilyConversation(F, U, ME, startInput('pro_pub_psico2', { clientMessageId: 'cm-1' }))
    const b = await ms.startFamilyConversation(F, U, ME, startInput('pro_pub_psico2', { clientMessageId: 'cm-1' }))
    expect(b.message.id).toBe(a.message.id)
    expect(b.conversation.id).toBe(a.conversation.id)

    const messages = await ms.listFamilyMessages(F, U, ME, a.conversation.id)
    expect(messages.items).toHaveLength(1)
  })

  it('participantLabel vazio ou com mais de 40 caracteres ⇒ VALIDATION_ERROR', async () => {
    await expect(ms.startFamilyConversation(F, U, ME, startInput('pro_pub_psico2', { participantLabel: '   ' }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    await expect(ms.startFamilyConversation(F, U, ME, startInput('pro_pub_psico2', { participantLabel: 'a'.repeat(41) }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('texto vazio ou com mais de 1000 caracteres ⇒ VALIDATION_ERROR; 1000 aceites', async () => {
    await expect(ms.startFamilyConversation(F, U, ME, startInput('pro_pub_psico2', { text: '   ' }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(ms.startFamilyConversation(F, U, ME, startInput('pro_pub_psico2', { text: 'a'.repeat(1001) }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
    await expect(ms.startFamilyConversation(F, U, ME, startInput('pro_pub_psico2', { text: 'a'.repeat(1000) }))).resolves.toMatchObject({ created: true })
  })

  it('profissional não aprovado (pro_fila) ou suspenso ⇒ NOT_FOUND', async () => {
    await expect(ms.startFamilyConversation(F, U, ME, startInput('pro_fila'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(ms.startFamilyConversation(F, U, ME, startInput('pro_suspensa'))).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('quarta mensagem seguida sem resposta ⇒ LIMIT_EXCEEDED', async () => {
    const started = await ms.startFamilyConversation(F, U, ME, startInput('pro_pub_psico2'))
    const id = started.conversation.id
    await ms.sendFamilyMessage(F, U, ME, id, { text: 'Segunda' })
    await ms.sendFamilyMessage(F, U, ME, id, { text: 'Terceira' })
    await expect(ms.sendFamilyMessage(F, U, ME, id, { text: 'Quarta' })).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' })
    await expect(ms.startFamilyConversation(F, U, ME, startInput('pro_pub_psico2', { text: 'Quarta' }))).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    })
  })

  it('conversa fechada pelo profissional ⇒ CONVERSATION_CLOSED ao reabrir por start', async () => {
    await portal.professionalLogin('marta.lopes@exemplo.ao', DEMO_PASSWORD)
    await ms.closeProfessionalConversation('cnv_seed_4')

    await expect(ms.startFamilyConversation(F, U, ME, startInput('pro_aprovada'))).rejects.toMatchObject({ code: 'CONVERSATION_CLOSED' })
  })
})

// ───── Mensagens e leitura ─────

describe('mensagens e leitura (família)', () => {
  it('listFamilyMessages ordena por seq decrescente e a leitura não marca como lido', async () => {
    const page = await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')
    expect(page.items.map((m) => m.seq)).toEqual([3, 2, 1])

    const before = await ms.getFamilyConversation(F, U, ME, 'cnv_seed_1')
    expect(before.unreadCount).toBe(2)
    await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')
    const after = await ms.getFamilyConversation(F, U, ME, 'cnv_seed_1')
    expect(after.unreadCount).toBe(2)
  })

  it('mine=true só nas mensagens do próprio', async () => {
    const page = await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')
    const bySeq = Object.fromEntries(page.items.map((m) => [m.seq, m]))
    expect(bySeq[1]?.mine).toBe(true)
    expect(bySeq[2]?.mine).toBe(false)
    expect(bySeq[3]?.mine).toBe(false)
  })

  it('readByOtherSide de mensagem da família segue o marcador do profissional', async () => {
    // O profissional leu até 3: a mensagem 1 da família está lida pelo outro lado.
    const page = await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')
    expect(page.items.find((m) => m.seq === 1)?.readByOtherSide).toBe(true)
  })

  // DEFEITO (handler): `toMessage` compara todas as mensagens com o marcador do lado oposto ao visualizador.
  // Para uma mensagem do próprio profissional (seq 3), o marcador usado é o do profissional (sempre ≥ seq após
  // escrever), por isso aparece lida antes de a família a ler. Segundo BR-MKT-40 deveria usar `familyReadSeq`.
  it('readByOtherSide de mensagem do profissional só fica true depois de a família ler (defeito)', async () => {
    const page = await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')
    expect(page.items.find((m) => m.seq === 3)?.readByOtherSide).toBe(false)

    await ms.markFamilyConversationRead(F, U, ME, 'cnv_seed_1')
    const later = await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')
    expect(later.items.find((m) => m.seq === 3)?.readByOtherSide).toBe(true)
  })

  it('markFamilyConversationRead avança o marcador e nunca recua', async () => {
    const read = await ms.markFamilyConversationRead(F, U, ME, 'cnv_seed_1')
    expect(read.unreadCount).toBe(0)

    const back = await ms.markFamilyConversationRead(F, U, ME, 'cnv_seed_1', 1)
    expect(back.unreadCount).toBe(0)
  })

  it('markFamilyConversationRead com seq fora do intervalo ⇒ VALIDATION_ERROR', async () => {
    await expect(ms.markFamilyConversationRead(F, U, ME, 'cnv_seed_1', 99)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('conversa de outro membro ou id inexistente ⇒ NOT_FOUND', async () => {
    await expect(ms.getFamilyConversation(F, U, ME, 'cnv_seed_2')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(ms.listFamilyMessages(F, U, ME, 'cnv_nao_existe')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})

// ───── Fechar e reabrir (família) ─────

describe('fechar e reabrir (família)', () => {
  it('fechar, reabrir e transições inválidas', async () => {
    const closed = await ms.closeFamilyConversation(F, U, ME, 'cnv_seed_1')
    expect(closed).toMatchObject({ status: 'CLOSED', closedBy: 'FAMILY', canSend: false })
    await expect(ms.closeFamilyConversation(F, U, ME, 'cnv_seed_1')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })

    const reopened = await ms.reopenFamilyConversation(F, U, ME, 'cnv_seed_1')
    expect(reopened).toMatchObject({ status: 'OPEN', canSend: true })
    expect(reopened.closedBy).toBeUndefined()
    await expect(ms.reopenFamilyConversation(F, U, ME, 'cnv_seed_1')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
  })

  it('a família reabre a conversa que ela própria fechou (cnv_seed_2)', async () => {
    const reopened = await ms.reopenFamilyConversation(F, U, 'mem_pedro', 'cnv_seed_2')
    expect(reopened).toMatchObject({ status: 'OPEN', canSend: true })
  })

  it('reabrir conversa fechada pelo profissional ⇒ CONVERSATION_CLOSED', async () => {
    await portal.professionalLogin('marta.lopes@exemplo.ao', DEMO_PASSWORD)
    await ms.closeProfessionalConversation('cnv_seed_4')
    await portal.professionalLogout()

    await expect(ms.reopenFamilyConversation(F, U, ME, 'cnv_seed_4')).rejects.toMatchObject({ code: 'CONVERSATION_CLOSED' })
  })
})

// ───── Profissional suspenso (cnv_seed_3) ─────

describe('profissional suspenso', () => {
  it('leitura continua; canSend false; enviar ⇒ CONVERSATION_CLOSED', async () => {
    const conv = await ms.getFamilyConversation(F, U, ME, 'cnv_seed_3')
    expect(conv).toMatchObject({ status: 'OPEN', canSend: false })

    const page = await ms.listFamilyMessages(F, U, ME, 'cnv_seed_3')
    expect(page.items).toHaveLength(2)

    await expect(ms.sendFamilyMessage(F, U, ME, 'cnv_seed_3', { text: 'Olá?' })).rejects.toMatchObject({ code: 'CONVERSATION_CLOSED' })
  })
})

// ───── Denúncias pela família ─────

describe('denúncia de mensagem (família)', () => {
  it('denunciar a própria mensagem ⇒ VALIDATION_ERROR', async () => {
    const own = (await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')).items.find((m) => m.seq === 1)!
    await expect(ms.reportFamilyMessage(F, U, ME, 'cnv_seed_1', own.id, { reason: 'SPAM' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('repetir a denúncia devolve o mesmo id', async () => {
    const msg2 = (await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')).items.find((m) => m.seq === 2)!
    const first = await ms.reportFamilyMessage(F, U, ME, 'cnv_seed_1', msg2.id, { reason: 'SPAM' })
    const again = await ms.reportFamilyMessage(F, U, ME, 'cnv_seed_1', msg2.id, { reason: 'SPAM' })
    expect(again.id).toBe(first.id)
    expect(first).toMatchObject({ status: 'OPEN', reason: 'SPAM' })
  })

  it('nota com mais de 300 caracteres ⇒ VALIDATION_ERROR; 300 aceites', async () => {
    const msg2 = (await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')).items.find((m) => m.seq === 2)!
    await expect(
      ms.reportFamilyMessage(F, U, ME, 'cnv_seed_1', msg2.id, { reason: 'OTHER', note: 'a'.repeat(301) }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(
      ms.reportFamilyMessage(F, U, ME, 'cnv_seed_1', msg2.id, { reason: 'OTHER', note: 'a'.repeat(300) }),
    ).resolves.toMatchObject({ status: 'OPEN' })
  })

  // DEFEITO (handler): `report()` não valida o motivo contra o conjunto fechado de `MessageReportReason`;
  // um motivo desconhecido é gravado tal como vem. Teste marcado com `fails` até o handler validar.
  it('motivo desconhecido ⇒ VALIDATION_ERROR (defeito: o handler não valida o motivo)', async () => {
    const msg2 = (await ms.listFamilyMessages(F, U, ME, 'cnv_seed_1')).items.find((m) => m.seq === 2)!
    await expect(
      ms.reportFamilyMessage(F, U, ME, 'cnv_seed_1', msg2.id, { reason: 'MOTIVO_INVENTADO' as never }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })
})

// ───── Lado do profissional ─────

describe('conversas do profissional (portal)', () => {
  it('sem sessão ⇒ INVALID_CREDENTIALS', async () => {
    professionalSessionStore.setAccountId(null)
    await expect(ms.listProfessionalConversations()).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await expect(ms.getProfessionalConversation('cnv_seed_4')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    await expect(ms.sendProfessionalMessage('cnv_seed_4', { text: 'Olá' })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  it('a vista não tem ids de família, membro, utilizador nem o profissional; só vê as suas conversas', async () => {
    await portal.professionalLogin('marta.lopes@exemplo.ao', DEMO_PASSWORD)
    const page = await ms.listProfessionalConversations()
    expect(page.items.map((c) => c.id)).toEqual(['cnv_seed_4'])
    for (const key of ['familyId', 'memberId', 'userId', 'professional', 'professionalId']) {
      expect(page.items[0]).not.toHaveProperty(key)
    }

    const detail = await ms.getProfessionalConversation('cnv_seed_4')
    expect(detail).not.toHaveProperty('familyId')
    expect(detail).not.toHaveProperty('memberId')
    expect(detail).not.toHaveProperty('userId')

    await expect(ms.getProfessionalConversation('cnv_seed_1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(ms.listProfessionalMessages('cnv_seed_1')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('responder, fechar e reabrir a conversa', async () => {
    await portal.professionalLogin('marta.lopes@exemplo.ao', DEMO_PASSWORD)

    const reply = await ms.sendProfessionalMessage('cnv_seed_4', { text: 'Sim, há aulas ao fim de semana.' })
    expect(reply).toMatchObject({ side: 'PROFESSIONAL', mine: true, hidden: false, text: 'Sim, há aulas ao fim de semana.' })

    const closed = await ms.closeProfessionalConversation('cnv_seed_4')
    expect(closed).toMatchObject({ status: 'CLOSED', closedBy: 'PROFESSIONAL', canSend: false })
    await expect(ms.closeProfessionalConversation('cnv_seed_4')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    await expect(ms.sendProfessionalMessage('cnv_seed_4', { text: 'Olá' })).rejects.toMatchObject({ code: 'CONVERSATION_CLOSED' })

    const reopened = await ms.reopenProfessionalConversation('cnv_seed_4')
    expect(reopened).toMatchObject({ status: 'OPEN', canSend: true })
    await expect(ms.reopenProfessionalConversation('cnv_seed_4')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
  })

  it('o profissional só reabre a conversa que ele próprio fechou', async () => {
    await portal.professionalLogin('marta.lopes@exemplo.ao', DEMO_PASSWORD)
    await ms.closeFamilyConversation(F, U, ME, 'cnv_seed_4')
    await expect(ms.reopenProfessionalConversation('cnv_seed_4')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
  })

  it('a família fechou primeiro: o profissional continua a poder ler', async () => {
    await portal.professionalLogin('marta.lopes@exemplo.ao', DEMO_PASSWORD)
    await ms.closeFamilyConversation(F, U, ME, 'cnv_seed_4')
    const page = await ms.listProfessionalMessages('cnv_seed_4')
    expect(page.items.length).toBeGreaterThan(0)
  })

  it('profissional suspenso: leitura ok; enviar, fechar e reabrir ⇒ PROFESSIONAL_LOCKED', async () => {
    await portal.professionalLogin('rui.tavares@exemplo.ao', DEMO_PASSWORD)

    const list = await ms.listProfessionalConversations()
    expect(list.items.map((c) => c.id)).toEqual(['cnv_seed_3'])
    const detail = await ms.getProfessionalConversation('cnv_seed_3')
    expect(detail.canSend).toBe(false)
    const messages = await ms.listProfessionalMessages('cnv_seed_3')
    expect(messages.items).toHaveLength(2)

    await expect(ms.sendProfessionalMessage('cnv_seed_3', { text: 'Olá' })).rejects.toMatchObject({ code: 'PROFESSIONAL_LOCKED' })
    await expect(ms.closeProfessionalConversation('cnv_seed_3')).rejects.toMatchObject({ code: 'PROFESSIONAL_LOCKED' })
    await expect(ms.reopenProfessionalConversation('cnv_seed_3')).rejects.toMatchObject({ code: 'PROFESSIONAL_LOCKED' })
  })
})
