// Moderação do ADMIN (UC-MKT-24, BR-MKT-44/48, OP-76). O admin NÃO tem acesso ao conteúdo das conversas: só vê, por denúncia, a mensagem
// denunciada e as até 2 mensagens imediatamente anteriores DA MESMA CONVERSA (por `seq`; uma anterior já oculta ocupa o lugar mas vem
// `hidden=true` e sem texto); nunca posteriores, mais antigas nem de outras conversas; nunca ids de família/membro/utilizador (exceto o
// `reportedUserId` da mensagem da FAMÍLIA, para a suspensão de conta já existente), nem o `participantLabel`. Abrir o detalhe é AUDITADO
// na mesma transação (`ADMIN_MESSAGE_REPORT_VIEW`, só `contextCount`; falha ⇒ a leitura falha). A decisão é única e serializada pelo
// bloqueio da linha da denúncia. Privacidade (BR-MKT-46): auditoria e erros nunca levam texto, nota nem rótulo.
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { decideReport, decisionEffects, moderationContext, REPORT_DECISIONS, type ReportDecision, type ReportStatus } from "../domain/report.js";
import { decodeConversationCursor, encodeConversationCursor } from "./cursor.js";
import type { ModerationRepository, ReportWithMessage } from "./moderation-ports.js";
import type { ActorIdentity, MessagingDeps, RequestContext } from "./ports.js";
import { parseLimit, type Page } from "./shared.js";

export interface AdminReportItemView {
  id: string;
  status: ReportStatus;
  reason: string;
  reportedSide: "FAMILY" | "PROFESSIONAL";
  professionalId: string;
  professionalDisplayName: string;
  createdAt: string;
}

export interface AdminReportDetailView {
  id: string;
  status: ReportStatus;
  reason: string;
  note: string | null;
  reportedSide: "FAMILY" | "PROFESSIONAL";
  professional: { id: string; displayName: string; city: string | null };
  /** Só se a mensagem for do lado da família e o utilizador ainda existir (OP-76). */
  reportedUserId: string | null;
  message: { id: string; text: string; hidden: boolean; createdAt: string };
  contextBefore: { id: string; seq: number; side: "FAMILY" | "PROFESSIONAL"; text: string | null; hidden: boolean; createdAt: string }[];
  decision: ReportDecision | null;
  decidedAt: string | null;
  createdAt: string;
}

export type ModerationDeps<Trx> = Pick<MessagingDeps<Trx>, "messages" | "professionals" | "audit" | "withTransaction" | "clock"> & { moderation: ModerationRepository<Trx> };

export function createModeration<Trx>(deps: ModerationDeps<Trx>) {
  const { moderation, messages } = deps;

  function assertAdmin(actor: ActorIdentity): void {
    if (!actor.platformAdmin) throw new ForbiddenError();
  }

  async function detail(trx: Trx, found: ReportWithMessage): Promise<AdminReportDetailView> {
    // O contexto é calculado por `seq` DENTRO da conversa da mensagem denunciada: pede-se à BD só as 2 anteriores (nunca a conversa toda).
    const before = await messages.listPage(trx, found.message.conversationId, 2, found.message.seq);
    const context = moderationContext(before, found.message);
    const identity = (await deps.professionals.findIdentities([found.professionalId]))[0];
    const reportedSide = found.message.side;
    return {
      id: found.report.id,
      status: found.report.status,
      reason: found.report.reason,
      note: found.report.note,
      reportedSide,
      professional: { id: found.professionalId, displayName: identity?.displayName ?? "Profissional", city: identity?.city ?? null },
      reportedUserId: reportedSide === "FAMILY" ? found.message.senderUserId : null,
      message: { id: found.message.id, text: found.message.body, hidden: found.message.hiddenAt !== null, createdAt: found.message.createdAt.toISOString() },
      contextBefore: context.map((m) => ({ id: m.id, seq: m.seq, side: m.side, text: m.text, hidden: m.hidden, createdAt: m.createdAt.toISOString() })),
      decision: found.report.decision,
      decidedAt: found.report.decidedAt?.toISOString() ?? null,
      createdAt: found.report.createdAt.toISOString(),
    };
  }

  return {
    /** Fila (mais antigas primeiro). NÃO devolve texto de mensagens: só motivo, profissional e hora. Não se audita (sem conteúdo). */
    async listReports(actor: ActorIdentity, query: { status?: ReportStatus; limit?: number; cursor?: string }): Promise<Page<AdminReportItemView>> {
      assertAdmin(actor);
      const limit = parseLimit(query.limit);
      const after = query.cursor === undefined || query.cursor === "" ? undefined : decodeConversationCursor(query.cursor);
      const rows = await deps.withTransaction((trx) => moderation.listQueue(trx, { status: query.status ?? "OPEN", limit: limit + 1, ...(after ? { after: { createdAt: after.lastMessageAt, id: after.id } } : {}) }));
      const page = rows.slice(0, limit);
      const names = new Map((await deps.professionals.findIdentities([...new Set(page.map((r) => r.professionalId))])).map((i) => [i.id, i.displayName] as const));
      const last = page[page.length - 1];
      return {
        items: page.map((r) => ({ id: r.id, status: r.status, reason: r.reason, reportedSide: r.reportedSide, professionalId: r.professionalId, professionalDisplayName: names.get(r.professionalId) ?? "Profissional", createdAt: r.createdAt.toISOString() })),
        nextCursor: rows.length > limit && last ? encodeConversationCursor(last.createdAt, last.id) : null,
      };
    },

    /** Detalhe com o texto: AUDITADO (`ADMIN_MESSAGE_REPORT_VIEW`, `contextCount` 0..2) na mesma transação. */
    async getReport(actor: ActorIdentity, reportId: string, context: RequestContext): Promise<AdminReportDetailView> {
      assertAdmin(actor);
      return deps.withTransaction(async (trx) => {
        const found = await moderation.findReport(trx, reportId, false);
        if (!found) throw new NotFoundError({ detail: "Denúncia não encontrada." });
        const view = await detail(trx, found);
        await deps.audit.record(trx, {
          occurredAt: deps.clock.now(),
          actorType: "PLATFORM_ADMIN",
          actorUserId: actor.userId,
          action: "ADMIN_MESSAGE_REPORT_VIEW",
          resourceType: "MessageReport",
          resourceId: found.report.id,
          result: "SUCCESS",
          requestId: context.requestId,
          ...auditContextFields(context),
          metadata: { contextCount: view.contextBefore.length },
        });
        return view;
      });
    },

    /** Decisão única (`OPEN → DECIDED`) sob o bloqueio da denúncia: a segunda ⇒ `INVALID_STATE_TRANSITION`. Auditoria sem conteúdo. */
    async decide(actor: ActorIdentity, reportId: string, input: { decision: string }, context: RequestContext): Promise<AdminReportDetailView> {
      assertAdmin(actor);
      const decision = REPORT_DECISIONS.find((d) => d === input.decision);
      if (!decision) throw new ValidationError([{ field: "decision", message: "decisão inválida" }], { detail: "Dados inválidos." });
      return deps.withTransaction(async (trx) => {
        const found = await moderation.findReport(trx, reportId, true);
        if (!found) throw new NotFoundError({ detail: "Denúncia não encontrada." });
        const next = decideReport({ status: found.report.status, decision: found.report.decision }, decision);
        if (!next.ok) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A denúncia já foi decidida." });
        const at = deps.clock.now();
        const effects = decisionEffects(decision);
        if (effects.hideMessage) await moderation.hideMessage(trx, found.message.id, at);
        if (effects.closeConversation) await moderation.closeConversationBySystem(trx, found.message.conversationId, at);
        await moderation.markDecided(trx, found.report.id, { decision, decidedBy: actor.userId, at });
        const refreshed = await moderation.findReport(trx, reportId, false);
        if (!refreshed) throw new NotFoundError({ detail: "Denúncia não encontrada." });
        const view = await detail(trx, refreshed);
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "PLATFORM_ADMIN",
          actorUserId: actor.userId,
          action: "ADMIN_MESSAGE_REPORT_DECIDE",
          resourceType: "MessageReport",
          resourceId: found.report.id,
          result: "SUCCESS",
          requestId: context.requestId,
          ...auditContextFields(context),
          metadata: { decision, fromStatus: "OPEN", toStatus: "DECIDED", contextCount: view.contextBefore.length },
        });
        return view;
      });
    },
  };
}

export type Moderation = ReturnType<typeof createModeration<unknown>>;
