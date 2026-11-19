import type { ChatSide, ConversationClosedBy, ConversationStatus, MessageReportDecision, MessageReportReason } from '@/types/marketplace'
import type { ProfessionalOffer } from '@/types/professional'

/**
 * “Base de dados” em memória do mercado do lado da família e do chat (MK2). Os profissionais aprovados de
 * `professionalDb` entram na descoberta com as suas ofertas ativas; `catalogExtras` acrescenta profissionais
 * só de catálogo (sem conta no portal) para haver coorte e ranking. O texto das mensagens nunca sai daqui
 * para logs (BR-MKT-46).
 */

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

export interface CatalogProfessional {
  id: string
  displayName: string
  city: string
  bio?: string
  specialtyIds: string[]
  offers: ProfessionalOffer[]
  approvedAt: string
  /** Próxima disponibilidade simulada (dias a partir de agora); `undefined` = sem horários. */
  nextAvailableInDays?: number
  /** Horários livres simulados nos próximos 14 dias (sinal de disponibilidade). */
  freeSlots14d: number
}

export interface MockMessage {
  id: string
  seq: number
  side: ChatSide
  authorUserId?: string
  text: string
  hidden: boolean
  createdAt: string
  clientMessageId?: string
}

export interface MockConversation {
  id: string
  familyId: string
  memberId: string
  professionalId: string
  participantLabel: string
  status: ConversationStatus
  closedBy?: ConversationClosedBy
  createdAt: string
  lastMessageAt: string
  familyReadSeq: number
  professionalReadSeq: number
  messages: MockMessage[]
}

export interface MockMessageReport {
  id: string
  conversationId: string
  messageId: string
  reporterSide: ChatSide
  reason: MessageReportReason
  note?: string
  status: 'OPEN' | 'DECIDED'
  decision?: MessageReportDecision
  decidedAt?: string
  createdAt: string
}

interface MarketplaceDb {
  catalogExtras: CatalogProfessional[]
  conversations: MockConversation[]
  reports: MockMessageReport[]
}

let seq = 0
export function mktId(prefix: string): string {
  seq += 1
  return `${prefix}_${seq.toString(36)}${crypto.randomUUID().slice(0, 6)}`
}

function offer(id: string, specialtyId: string, method: ProfessionalOffer['method'], durationMinutes: ProfessionalOffer['durationMinutes'], priceKz: number, note?: string): ProfessionalOffer {
  return { id, specialtyId, method, durationMinutes, priceKz, note, active: true }
}

function msg(n: number, side: ChatSide, text: string, ageDays: number, extra: Partial<MockMessage> = {}): MockMessage {
  return { id: `msg_seed_${n}_${side[0]}${Math.round(ageDays * 10)}`, seq: n, side, text, hidden: false, createdAt: daysAgo(ageDays), authorUserId: side === 'FAMILY' ? 'usr_monarca' : undefined, ...extra }
}

function seed(): MarketplaceDb {
  const catalogExtras: CatalogProfessional[] = [
    {
      id: 'pro_pub_psico1',
      displayName: 'Dra. Teresa Neto',
      city: 'Luanda',
      bio: 'Psicóloga clínica com foco em ansiedade e acompanhamento de famílias. Consultas em português e inglês, com atenção especial a adolescentes.',
      specialtyIds: ['spc_psico'],
      approvedAt: daysAgo(400),
      nextAvailableInDays: 1,
      freeSlots14d: 18,
      offers: [offer('ofr_pub_1', 'spc_psico', 'IN_PERSON', 60, 18000, 'Consultório em Talatona'), offer('ofr_pub_2', 'spc_psico', 'VIDEO', 45, 15000)],
    },
    {
      id: 'pro_pub_psico2',
      displayName: 'Carlos Baptista',
      city: 'Luanda',
      bio: 'Psicólogo.',
      specialtyIds: ['spc_psico'],
      approvedAt: daysAgo(30),
      nextAvailableInDays: 6,
      freeSlots14d: 4,
      offers: [offer('ofr_pub_3', 'spc_psico', 'VIDEO', 45, 12000)],
    },
    {
      id: 'pro_pub_psico3',
      displayName: 'Dra. Inês Sebastião',
      city: 'Benguela',
      bio: 'Psicóloga infantil e do desenvolvimento. Trabalho com pais e escolas, com sessões curtas de acompanhamento e orientação.',
      specialtyIds: ['spc_psico'],
      approvedAt: daysAgo(220),
      nextAvailableInDays: 3,
      freeSlots14d: 9,
      offers: [offer('ofr_pub_4', 'spc_psico', 'IN_PERSON', 60, 20000, 'Clínica Restinga'), offer('ofr_pub_5', 'spc_psico', 'PHONE', 30, 9000), offer('ofr_pub_6', 'spc_psico', 'VIDEO', 45, 14000)],
    },
    {
      id: 'pro_pub_nutri1',
      displayName: 'Dr. Paulo Quissanga',
      city: 'Luanda',
      bio: 'Nutricionista com experiência em planos alimentares familiares e diabetes.',
      specialtyIds: ['spc_nutri'],
      approvedAt: daysAgo(90),
      nextAvailableInDays: 2,
      freeSlots14d: 12,
      offers: [offer('ofr_pub_7', 'spc_nutri', 'CHAT', 30, 7000), offer('ofr_pub_8', 'spc_nutri', 'IN_PERSON', 60, 16000, 'Plano alimentar incluído')],
    },
    {
      id: 'pro_pub_treino1',
      displayName: 'Sofia Domingos',
      city: 'Huambo',
      specialtyIds: ['spc_treino', 'spc_yoga'],
      approvedAt: daysAgo(15),
      freeSlots14d: 0,
      offers: [offer('ofr_pub_9', 'spc_treino', 'IN_PERSON', 60, 10000), offer('ofr_pub_10', 'spc_yoga', 'VIDEO', 45, 8000)],
    },
  ]

  const monarca = 'usr_monarca'
  const conversations: MockConversation[] = [
    {
      id: 'cnv_seed_1',
      familyId: 'fam_monarca',
      memberId: 'mem_monarca',
      professionalId: 'pro_pub_psico1',
      participantLabel: 'Monarca',
      status: 'OPEN',
      createdAt: daysAgo(3),
      lastMessageAt: daysAgo(1),
      familyReadSeq: 1,
      professionalReadSeq: 3,
      messages: [
        msg(1, 'FAMILY', 'Bom dia. Têm disponibilidade para uma primeira consulta online?', 3, { authorUserId: monarca }),
        msg(2, 'PROFESSIONAL', 'Bom dia! Sim, tenho horários esta semana. Prefere de manhã ou à tarde?', 2),
        msg(3, 'PROFESSIONAL', 'Posso também fazer uma conversa curta de 15 minutos para nos conhecermos.', 1),
      ],
    },
    {
      id: 'cnv_seed_2',
      familyId: 'fam_monarca',
      memberId: 'mem_pedro',
      professionalId: 'pro_pub_psico3',
      participantLabel: 'Pai do Pedro',
      status: 'CLOSED',
      closedBy: 'FAMILY',
      createdAt: daysAgo(20),
      lastMessageAt: daysAgo(18),
      familyReadSeq: 2,
      professionalReadSeq: 2,
      messages: [
        msg(1, 'FAMILY', 'Qual o preço de uma sessão presencial para uma criança de 8 anos?', 20, { authorUserId: monarca }),
        msg(2, 'PROFESSIONAL', 'A sessão presencial custa 20 000 Kz e dura 60 minutos.', 18),
      ],
    },
    {
      // Profissional suspenso: leitura continua, ninguém envia (BR-MKT-47).
      id: 'cnv_seed_3',
      familyId: 'fam_monarca',
      memberId: 'mem_monarca',
      professionalId: 'pro_suspensa',
      participantLabel: 'Monarca',
      status: 'OPEN',
      createdAt: daysAgo(30),
      lastMessageAt: daysAgo(29),
      familyReadSeq: 2,
      professionalReadSeq: 1,
      messages: [
        msg(1, 'FAMILY', 'Gostava de saber se faz planos alimentares para idosos.', 30, { authorUserId: monarca }),
        msg(2, 'PROFESSIONAL', 'Sim, faço. Podemos marcar uma avaliação inicial.', 29),
      ],
    },
    {
      // Conversa do portal da Marta Lopes (aprovada): para a vista do profissional.
      id: 'cnv_seed_4',
      familyId: 'fam_monarca',
      memberId: 'mem_monarca',
      professionalId: 'pro_aprovada',
      participantLabel: 'Monarca',
      status: 'OPEN',
      createdAt: daysAgo(2),
      lastMessageAt: daysAgo(0.1),
      familyReadSeq: 1,
      professionalReadSeq: 1,
      messages: [
        msg(1, 'FAMILY', 'Boa tarde, as aulas de yoga são adequadas para iniciantes?', 2, { authorUserId: monarca }),
        msg(2, 'FAMILY', 'E tem aulas ao fim de semana?', 0.1, { authorUserId: monarca }),
      ],
    },
  ]

  const reports: MockMessageReport[] = [
    {
      id: 'rep_seed_1',
      conversationId: 'cnv_seed_1',
      messageId: conversations[0]?.messages[2]?.id ?? '',
      reporterSide: 'FAMILY',
      reason: 'SCAM_OR_OFF_PLATFORM_PAYMENT',
      note: 'Pediu pagamento por fora da plataforma.',
      status: 'OPEN',
      createdAt: daysAgo(0.5),
    },
  ]
  return { catalogExtras, conversations, reports }
}

export let marketplaceDb: MarketplaceDb = seed()

export function resetMarketplaceDb() {
  marketplaceDb = seed()
}
