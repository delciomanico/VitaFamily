import type { Tone } from '@/components/ui/Badge'
import { LEGAL_PLACEHOLDER_TAG } from '@/lib/consultations'
import type { ProfessionalPrescriptionMedication, RecordShareCategory, RecordShareStatus, SharedBloodType, ShareValidity } from '@/types/recordSharing'

/**
 * Textos em pt-AO da partilha de registos com prazo (MK4). A família nunca vê vocabulário técnico (estados do
 * contrato, ids). Os textos legais e avisos (OP-128) são constantes da UI marcadas `[PROVISÓRIO]` até serem ratificados.
 */

/** Texto honesto sobre capturas (BR-MKT-72): não se vende a visualização única como proteção forte. */
export const SCREENSHOT_NOTICE = `${LEGAL_PLACEHOLDER_TAG} Não conseguimos impedir capturas de ecrã. Partilhe só o que quer que o profissional veja. Todos os acessos ficam registados.`
/** Consentimento da partilha (inclui o do tutor pelo dependente). */
export const SHARE_CONSENT_NOTICE = `${LEGAL_PLACEHOLDER_TAG} Ao partilhar, autoriza este profissional a ver só as categorias escolhidas, até ao fim do prazo. Pode parar a partilha quando quiser. Se partilhar em nome de um dependente, fá-lo como tutor.`
/** Explicação da visualização única, sem a vender como proteção forte. */
export const VIEW_ONCE_NOTICE = `${LEGAL_PLACEHOLDER_TAG} O profissional só pode abrir uma vez. Se a ligação falhar depois de abrir, a partilha fica usada e terá de criar outra. Não impede capturas de ecrã.`
/** Texto de «Quem viu». */
export const WHO_VIEWED_NOTICE = `${LEGAL_PLACEHOLDER_TAG} Aqui vê cada vez que o profissional abriu a partilha: quem, o quê e quando. Não impedimos capturas de ecrã.`
/** Aviso ao profissional ao abrir (marca de água e confidencialidade). */
export const PROFESSIONAL_OPEN_NOTICE = `${LEGAL_PLACEHOLDER_TAG} Estes dados são confidenciais e só para a consulta. A marca de água identifica quem os abriu. Não os guarde nem os reencaminhe.`
/** Aviso da receita digital e da sua origem (só aparece com a receita digital ligada). */
export const PRESCRIPTION_NOTICE = `${LEGAL_PLACEHOLDER_TAG} A receita fica no registo do membro e a família só a pode ler. Confirme os dados antes de emitir: depois de emitida, não pode ser alterada.`
/** Nota na receita emitida por um profissional (lado da família). */
export const PRESCRIPTION_READ_ONLY_NOTICE = 'Esta receita foi emitida pelo profissional e só pode ser lida. Pode ajustar os horários dos lembretes, concluir, cancelar ou apagar a receita.'
/** Aviso do chat: remete para a partilha com prazo (BR-MKT-75; OP-85/OP-128). */
export const SHARE_CHAT_HINT = 'Para partilhar o seu registo, use a partilha com prazo.'

export const MAX_ACTIVE_SHARES = 20
export const PRESCRIPTION_NOTES_MAX = 500
export const MAX_PRESCRIPTION_MEDICATIONS = 10

export const categoryLabel: Record<RecordShareCategory, string> = {
  ALLERGIES: 'Alergias e tipo de sangue',
  CONDITIONS: 'Condições e antecedentes',
  MEDICATION: 'Medicação ativa',
  APPOINTMENTS: 'Consultas',
  EXAMS: 'Exames',
}

export const validityLabel: Record<ShareValidity, string> = {
  H24: '24 horas',
  D7: '7 dias',
  D30: '30 dias',
  UNTIL_CONSULTATION_END_PLUS_24H: 'Até 24 horas depois da consulta',
}

export const categoriesText = (categories: RecordShareCategory[]): string => categories.map((c) => categoryLabel[c]).join(', ')

interface StatusText {
  label: string
  tone: Tone
}

/** Estado visto pela família. */
export const familyShareStatusText: Record<RecordShareStatus, StatusText> = {
  ACTIVE: { label: 'Ativa', tone: 'success' },
  EXPIRED: { label: 'Terminou o prazo', tone: 'neutral' },
  REVOKED: { label: 'Parada por si', tone: 'neutral' },
  CONSUMED: { label: 'Já aberta (visualização única)', tone: 'primary' },
}

/**
 * Estado visto pelo profissional: não distingue as causas (prazo, paragem pela família ou marcação cancelada,
 * BR-MKT-70); só «já visto» (visualização única) e «indisponível».
 */
export function professionalShareStatusText(status: RecordShareStatus, canOpen: boolean): StatusText {
  if (status === 'CONSUMED') return { label: 'Já visto', tone: 'primary' }
  if (status !== 'ACTIVE' || !canOpen) return { label: 'Indisponível', tone: 'neutral' }
  return { label: 'Disponível', tone: 'success' }
}

export const bloodTypeLabel: Record<SharedBloodType, string> = {
  A_POS: 'A+',
  A_NEG: 'A-',
  B_POS: 'B+',
  B_NEG: 'B-',
  AB_POS: 'AB+',
  AB_NEG: 'AB-',
  O_POS: 'O+',
  O_NEG: 'O-',
  UNKNOWN: 'Não indicado',
}

/** Frequência de um medicamento da receita, em frase simples. */
export function frequencyText(m: Pick<ProfessionalPrescriptionMedication, 'scheduleType' | 'times' | 'intervalHours'>): string {
  if (m.scheduleType === 'INTERVAL') return `De ${m.intervalHours ?? '?'} em ${m.intervalHours ?? '?'} horas`
  return `Às ${(m.times ?? []).join(', ')}`
}

/** Idade em anos completos entre duas datas `AAAA-MM-DD` (dia de Luanda), sem passar por data local. */
export function ageBetween(birthDate: string, onDay: string): number {
  const [by = 0, bm = 1, bd = 1] = birthDate.split('-').map(Number)
  const [y = 0, m = 1, d = 1] = onDay.split('-').map(Number)
  let age = y - by
  if (m < bm || (m === bm && d < bd)) age -= 1
  return Math.max(age, 0)
}

/**
 * Só endereços `http(s)` viram ligação (texto livre vindo de terceiros nunca vira `javascript:` nem `data:`).
 * Devolve `undefined` se o valor não for um URL http(s) válido.
 */
export function safeHref(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}
