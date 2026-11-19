import { AppError } from '@/lib/errors'
import type { AdminMessageReportDetail, AdminMessageReportItem, MessageReportDecision, Page } from '@/types/marketplace'
import { marketplaceDb, type MockMessageReport } from '../marketplaceDb'
import { respond } from '../respond'
import { publicProfessionalName } from './marketplace'

/*
 * Moderação de denúncias (`/admin/message-reports*`, MK2, BR-MKT-44, UC-MKT-24). O admin vê a mensagem
 * denunciada e, no máximo, as 2 imediatamente anteriores; nunca família, membro nem `participantLabel`.
 */

const PAGE_SIZE = 20

function recordOf(reportId: string) {
  const report = marketplaceDb.reports.find((r) => r.id === reportId)
  const conversation = report && marketplaceDb.conversations.find((c) => c.id === report.conversationId)
  const message = report && conversation?.messages.find((m) => m.id === report.messageId)
  if (!report || !conversation || !message) throw new AppError('NOT_FOUND')
  return { report, conversation, message }
}

const reportedSide = (r: MockMessageReport) => (r.reporterSide === 'FAMILY' ? 'PROFESSIONAL' : 'FAMILY')

export function adminListMessageReports(query: { status?: 'OPEN' | 'DECIDED'; limit?: number; cursor?: string } = {}): Promise<Page<AdminMessageReportItem>> {
  return respond(() => {
    const status = query.status ?? 'OPEN'
    const all = marketplaceDb.reports
      .filter((r) => r.status === status)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((r): AdminMessageReportItem => {
        const conversation = marketplaceDb.conversations.find((c) => c.id === r.conversationId)
        const professional = publicProfessionalName(conversation?.professionalId ?? '')
        return {
          id: r.id,
          status: r.status,
          reason: r.reason,
          reportedSide: reportedSide(r),
          professionalId: professional?.id ?? '',
          professionalDisplayName: professional?.displayName ?? 'Profissional',
          createdAt: r.createdAt,
        }
      })
    const size = Math.min(query.limit ?? PAGE_SIZE, 100)
    const start = query.cursor ? Number(query.cursor) : 0
    if (!Number.isInteger(start) || start < 0) throw new AppError('VALIDATION_ERROR')
    return { items: all.slice(start, start + size), nextCursor: start + size < all.length ? String(start + size) : null }
  })
}

export function adminGetMessageReport(reportId: string): Promise<AdminMessageReportDetail> {
  return respond(() => {
    const { report, conversation, message } = recordOf(reportId)
    const professional = publicProfessionalName(conversation.professionalId) ?? { id: conversation.professionalId, displayName: 'Profissional' }
    const contextBefore = conversation.messages
      .filter((m) => m.seq < message.seq)
      .sort((a, b) => b.seq - a.seq)
      .slice(0, 2)
      .reverse()
      .map((m) => ({ id: m.id, seq: m.seq, side: m.side, text: m.hidden ? undefined : m.text, hidden: m.hidden, createdAt: m.createdAt }))
    return {
      id: report.id,
      status: report.status,
      reason: report.reason,
      note: report.note,
      reportedSide: reportedSide(report),
      professional,
      reportedUserId: message.side === 'FAMILY' ? message.authorUserId : undefined,
      message: { id: message.id, text: message.text, hidden: message.hidden, createdAt: message.createdAt },
      contextBefore,
      decision: report.decision,
      decidedAt: report.decidedAt,
      createdAt: report.createdAt,
    }
  })
}

export function adminDecideMessageReport(reportId: string, decision: MessageReportDecision): Promise<AdminMessageReportDetail> {
  return respond(() => {
    const { report, conversation, message } = recordOf(reportId)
    if (report.status === 'DECIDED') throw new AppError('INVALID_STATE_TRANSITION')
    if (decision !== 'DISMISS') message.hidden = true
    if (decision === 'HIDE_AND_CLOSE') {
      conversation.status = 'CLOSED'
      conversation.closedBy = 'SYSTEM'
    }
    report.status = 'DECIDED'
    report.decision = decision
    report.decidedAt = new Date().toISOString()
  }).then(() => adminGetMessageReport(reportId))
}
