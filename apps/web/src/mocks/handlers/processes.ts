import { AppError } from '@/lib/errors'
import type { AlertType } from '@/types/alert'
import type { FamilyProcess } from '@/types/process'
import { memberAccess } from '../access'
import type { AlertSources, MockAlert } from '../alertRules'
import { db } from '../db'
import { respond } from '../respond'

/**
 * Processo do membro (UC-PRC-04). Inexistente, de outro membro/família ou sem acesso ⇒ NOT_FOUND (sem enumeração).
 * `coverage` só com «gerir» (titular/tutor, `MANAGE_INSURANCE`); para os restantes é `null`, sem erro (BR-PRC-13);
 * um processo aberto por um pedido (origem `AUTHORIZATION`) só é legível por quem gere.
 */
export function getProcess(familyId: string, userId: string, memberId: string, processId: string) {
  return respond((): FamilyProcess => {
    const access = memberAccess(familyId, userId, memberId)
    const found = db.processes.find((p) => p.id === processId && p.familyId === familyId && p.memberId === memberId)
    if (!found || (found.origin.type === 'AUTHORIZATION' && !access.manage)) throw new AppError('NOT_FOUND')
    const { familyId: _family, ...process } = found
    return access.manage ? process : { ...process, coverage: null }
  })
}

/** Evento do pedido à seguradora que avisa a família (BR-ALR-10; no servidor corre na transação da transição). */
export type AuthorizationAlertKind = 'APPROVED' | 'NOT_APPROVED' | 'INFO_REQUESTED' | 'EXPIRING' | 'WITHDRAWN'

const ALERT_OF: Record<AuthorizationAlertKind, { type: AlertType; ruleKey: MockAlert['ruleKey'] }> = {
  APPROVED: { type: 'AUTHORIZATION_APPROVED', ruleKey: 'authorization.approved' },
  NOT_APPROVED: { type: 'AUTHORIZATION_NOT_APPROVED', ruleKey: 'authorization.not_approved' },
  INFO_REQUESTED: { type: 'AUTHORIZATION_INFO_REQUESTED', ruleKey: 'authorization.info_requested' },
  EXPIRING: { type: 'AUTHORIZATION_EXPIRING', ruleKey: 'authorization.expiring' },
  WITHDRAWN: { type: 'AUTHORIZATION_WITHDRAWN', ruleKey: 'authorization.withdrawn' },
}

/**
 * Cria o alerta para quem tem `MANAGE_INSURANCE` (titular adulto com conta e tutores; nunca o dependente com conta),
 * `sourceType=PROCESS`, `sourceId=processId`; idempotente por (regra, processo, destinatário, instante).
 */
export function raiseAuthorizationAlert(
  data: Pick<AlertSources, 'members' | 'guardianships' | 'alerts'> & { processes: { id: string; familyId: string; memberId: string }[] },
  kind: AuthorizationAlertKind,
  processId: string,
  now: Date,
): MockAlert[] {
  const process = data.processes.find((p) => p.id === processId)
  const member = data.members.find((m) => m.id === process?.memberId && m.status === 'ACTIVE')
  if (!process || !member) return []
  const recipients = member.isDependent
    ? data.guardianships.filter((g) => g.dependentId === member.id).map((g) => g.guardianId)
    : [member.id]
  const created: MockAlert[] = []
  for (const memberId of recipients) {
    const userId = data.members.find((m) => m.id === memberId && m.status === 'ACTIVE')?.userId
    if (!userId) continue
    const { type, ruleKey } = ALERT_OF[kind]
    const dedupeKey = `${ruleKey}:${processId}:${userId}:${now.toISOString()}`
    if (data.alerts.some((a) => a.dedupeKey === dedupeKey)) continue
    created.push({
      id: `alr_prc_${data.alerts.length + created.length + 1}`,
      recipientUserId: userId,
      dedupeKey,
      familyId: process.familyId,
      memberId: process.memberId,
      type,
      ruleKey,
      sourceType: 'PROCESS',
      sourceId: processId,
      triggerAt: now.toISOString(),
    })
  }
  data.alerts.push(...created)
  return created
}
