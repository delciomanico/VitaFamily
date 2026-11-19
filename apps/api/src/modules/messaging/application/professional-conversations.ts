// Casos de uso do lado do PROFISSIONAL (UC-MKT-20/23; BR-MKT-38..48; authorization.md §10.2). O profissional SÓ responde (não abre
// conversas) e a conversa procura-se SEMPRE por (`professionalId` do token, id): outra ou inexistente ⇒ `NOT_FOUND` idêntico. Nunca vê
// ids de família, membro nem utilizador: só o `participantLabel` (as vistas não os têm). O estado de validação lê-se por pedido de
// `ProfessionalLookup` (sem cache, nunca do token): leitura/marcar lido/denunciar em qualquer estado; enviar/fechar/reabrir só `APPROVED`
// (senão `PROFESSIONAL_LOCKED`, que precede `CONVERSATION_CLOSED`, OP-91). Privacidade (BR-MKT-46): erros e auditoria sem texto nem nota.
import { DomainError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { advanceRead, closeConversation, nextSeq, reopenConversation, sendBlock } from "../domain/conversation.js";
import { checkReportLimit, checkSendLimits, DAY_MS, HOUR_MS } from "../domain/limits.js";
import type { Message } from "../domain/message.js";
import { canReport, REPORT_REASONS, type ReportReason } from "../domain/report.js";
import { validateMessageText, validateReportNote } from "../domain/text.js";
import { decodeConversationCursor, decodeSeqCursor, encodeConversationCursor, encodeSeqCursor } from "./cursor.js";
import type { ConversationRecord, MessagingDeps, ProfessionalActor, RequestContext } from "./ports.js";
import { enforce, invalid, parseLimit, type Page } from "./shared.js";
import { toProfessionalConversationView, toProfessionalMessageView, toState, type ChatMessageView, type ProfessionalConversationView } from "./views.js";

export interface ProfessionalSendInput {
  text: string;
  clientMessageId?: string;
}

export interface ProfessionalReportInput {
  reason: string;
  note?: string;
}

export function createProfessionalMessaging<Trx>(deps: MessagingDeps<Trx>) {
  const { conversations, messages, reports } = deps;
  const now = (): Date => deps.clock.now();

  /** Estado de validação AGORA (sem cache); profissional inexistente ⇒ não aprovado (nada se escreve). */
  async function isApproved(professionalId: string): Promise<boolean> {
    return (await deps.professionals.findIdentities([professionalId]))[0]?.approved ?? false;
  }

  async function load(trx: Trx, actor: ProfessionalActor, conversationId: string, forUpdate: boolean): Promise<ConversationRecord> {
    const conversation = await conversations.findForProfessional(trx, actor.professionalId, conversationId, forUpdate);
    if (!conversation) throw new NotFoundError({ detail: "Conversa não encontrada." });
    return conversation;
  }

  function assertApproved(approved: boolean): void {
    if (!approved) throw new DomainError("PROFESSIONAL_LOCKED", { detail: "O seu perfil não está aprovado: só pode consultar as conversas." });
  }

  return {
    /** UC-MKT-20: lista (última mensagem primeiro). Leitura em todos os estados. */
    async listConversations(actor: ProfessionalActor, query: { status?: "OPEN" | "CLOSED"; limit?: number; cursor?: string }): Promise<Page<ProfessionalConversationView>> {
      const limit = parseLimit(query.limit);
      const after = query.cursor === undefined || query.cursor === "" ? undefined : decodeConversationCursor(query.cursor);
      const rows = await deps.withTransaction((trx) => conversations.listForProfessional(trx, actor.professionalId, { limit: limit + 1, ...(query.status ? { status: query.status } : {}), ...(after ? { after } : {}) }));
      const approved = await isApproved(actor.professionalId);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return { items: page.map((c) => toProfessionalConversationView(c, approved, c.unreadForProfessional)), nextCursor: rows.length > limit && last ? encodeConversationCursor(last.lastMessageAt, last.id) : null };
    },

    async getConversation(actor: ProfessionalActor, conversationId: string): Promise<ProfessionalConversationView> {
      const { conversation, unread } = await deps.withTransaction(async (trx) => {
        const found = await load(trx, actor, conversationId, false);
        return { conversation: found, unread: await conversations.unreadForProfessional(trx, found.id, found.professionalReadSeq) };
      });
      return toProfessionalConversationView(conversation, await isApproved(actor.professionalId), unread);
    },

    /** Mensagens por `seq` decrescente com cursor. NÃO marca como lido (BR-MKT-40); não se audita. */
    async listMessages(actor: ProfessionalActor, conversationId: string, query: { limit?: number; cursor?: string }): Promise<Page<ChatMessageView>> {
      const limit = parseLimit(query.limit);
      const beforeSeq = query.cursor === undefined || query.cursor === "" ? undefined : decodeSeqCursor(query.cursor);
      return deps.withTransaction(async (trx) => {
        const conversation = await load(trx, actor, conversationId, false);
        const rows = await messages.listPage(trx, conversation.id, limit + 1, beforeSeq);
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return { items: page.map((m) => toProfessionalMessageView(m, conversation)), nextCursor: rows.length > limit && last ? encodeSeqCursor(last.seq) : null };
      });
    },

    /** UC-MKT-20: resposta com `seq` sob o bloqueio da linha, idempotente por `clientMessageId`, alerta à família na MESMA transação. */
    async sendMessage(actor: ProfessionalActor, conversationId: string, input: ProfessionalSendInput): Promise<{ created: boolean; message: ChatMessageView }> {
      const approved = await isApproved(actor.professionalId);
      return deps.withTransaction(async (trx) => {
        const text = validateMessageText(input.text);
        if (!text.ok) throw invalid("text", text.error);
        await conversations.acquireLocks(trx, [`message-professional:${actor.professionalId}`]);
        const conversation = await load(trx, actor, conversationId, true);
        const block = sendBlock(conversation, "PROFESSIONAL", approved);
        if (block === "PROFESSIONAL_LOCKED") assertApproved(false);
        const clientMessageId = input.clientMessageId ?? null;
        const replay = clientMessageId === null ? null : await messages.findByClientMessageId(trx, conversation.id, clientMessageId);
        if (replay) return { created: false, message: toProfessionalMessageView(replay, conversation) };
        if (block !== null) throw new DomainError("CONVERSATION_CLOSED", { detail: "Esta conversa está fechada." });

        const at = now();
        const nowMs = at.getTime();
        enforce(
          checkSendLimits({
            side: "PROFESSIONAL",
            nowMs,
            conversationMessageTimes: (await messages.professionalTimesInConversation(trx, conversation.id, new Date(nowMs - HOUR_MS))).map((d) => d.getTime()),
            senderDayMessageTimes: (await messages.professionalTimes(trx, actor.professionalId, new Date(nowMs - DAY_MS))).map((d) => d.getTime()),
            consecutiveFamilyWithoutReply: 0,
          }),
        );
        const seq = nextSeq(conversation.lastSeq);
        const message: Message = { id: newId(), conversationId: conversation.id, seq, side: "PROFESSIONAL", senderUserId: null, body: text.text, clientMessageId, hiddenAt: null, createdAt: at };
        await messages.insert(trx, message);
        await conversations.applyMessage(trx, conversation.id, { lastSeq: seq, at, side: "PROFESSIONAL" });
        // BR-MKT-41: um alerta por conversa até a família a ler (o `dedupeKey` da `alerts` inclui `familyReadSeq`), na mesma transação.
        await deps.alerts.raiseMessageReceived(trx, { conversationId: conversation.id, familyId: conversation.familyId, memberId: conversation.memberId, familyReadSeq: conversation.familyReadSeq });
        return { created: true, message: toProfessionalMessageView(message, { ...conversation, lastSeq: seq, lastMessageAt: at }) };
      });
    },

    /** Marcador de leitura do profissional (BR-MKT-40): monótono, idempotente, permitido em TODOS os estados (não é escrita bloqueada). */
    async markRead(actor: ProfessionalActor, conversationId: string, upToSeq: number | undefined): Promise<ProfessionalConversationView> {
      const { conversation, unread } = await deps.withTransaction(async (trx) => {
        const found = await load(trx, actor, conversationId, true);
        const advanced = advanceRead(toState(found), "PROFESSIONAL", upToSeq);
        if (!advanced.ok) throw new ValidationError([{ field: "upToSeq", message: "fora do intervalo da conversa" }], { detail: "Dados inválidos." });
        const professionalReadSeq = advanced.state.professionalReadSeq;
        if (professionalReadSeq !== found.professionalReadSeq) await conversations.setProfessionalReadSeq(trx, found.id, professionalReadSeq, now());
        return { conversation: { ...found, professionalReadSeq }, unread: await conversations.unreadForProfessional(trx, found.id, professionalReadSeq) };
      });
      return toProfessionalConversationView(conversation, await isApproved(actor.professionalId), unread);
    },

    /** BR-MKT-43: só `APPROVED`; auditoria `PROFESSIONAL_CONVERSATION_CLOSE` (sem `familyId`: o profissional não conhece a família). */
    async closeConversation(actor: ProfessionalActor, conversationId: string, context: RequestContext): Promise<ProfessionalConversationView> {
      const approved = await isApproved(actor.professionalId);
      const { conversation, unread } = await deps.withTransaction(async (trx) => {
        const found = await load(trx, actor, conversationId, true);
        assertApproved(approved);
        const result = closeConversation(toState(found), "PROFESSIONAL");
        if (!result.ok) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A conversa já está fechada." });
        const at = now();
        await conversations.setStatus(trx, found.id, { status: "CLOSED", closedBy: "PROFESSIONAL", at });
        await deps.audit.record(trx, { occurredAt: at, actorType: "PROFESSIONAL_ACCOUNT", actorProfessionalAccountId: actor.professionalAccountId, action: "PROFESSIONAL_CONVERSATION_CLOSE", resourceType: "Conversation", resourceId: found.id, result: "SUCCESS", requestId: context.requestId, ...auditContextFields(context) });
        return { conversation: { ...found, status: "CLOSED" as const, closedBy: "PROFESSIONAL" as const, closedAt: at }, unread: await conversations.unreadForProfessional(trx, found.id, found.professionalReadSeq) };
      });
      return toProfessionalConversationView(conversation, approved, unread);
    },

    async reopenConversation(actor: ProfessionalActor, conversationId: string, context: RequestContext): Promise<ProfessionalConversationView> {
      const approved = await isApproved(actor.professionalId);
      const { conversation, unread } = await deps.withTransaction(async (trx) => {
        const found = await load(trx, actor, conversationId, true);
        assertApproved(approved);
        const result = reopenConversation(toState(found), "PROFESSIONAL");
        if (!result.ok) {
          // Fechada pela família ou pelo sistema ⇒ `CONVERSATION_CLOSED` (sem revelar quem); aberta ⇒ `INVALID_STATE_TRANSITION`.
          if (found.status === "CLOSED") throw new DomainError("CONVERSATION_CLOSED", { detail: "Esta conversa não pode ser reaberta." });
          throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A conversa já está aberta." });
        }
        const at = now();
        await conversations.setStatus(trx, found.id, { status: "OPEN", closedBy: null, at });
        await deps.audit.record(trx, { occurredAt: at, actorType: "PROFESSIONAL_ACCOUNT", actorProfessionalAccountId: actor.professionalAccountId, action: "PROFESSIONAL_CONVERSATION_REOPEN", resourceType: "Conversation", resourceId: found.id, result: "SUCCESS", requestId: context.requestId, ...auditContextFields(context) });
        return { conversation: { ...found, status: "OPEN" as const, closedBy: null, closedAt: null }, unread: await conversations.unreadForProfessional(trx, found.id, found.professionalReadSeq) };
      });
      return toProfessionalConversationView(conversation, approved, unread);
    },

    /** UC-MKT-23: uma denúncia por (mensagem, lado); só mensagens da família; permitida em TODOS os estados (segurança). */
    async reportMessage(actor: ProfessionalActor, conversationId: string, messageId: string, input: ProfessionalReportInput, context: RequestContext): Promise<{ created: boolean; receipt: { id: string; status: "OPEN" | "DECIDED"; reason: ReportReason; createdAt: string } }> {
      return deps.withTransaction(async (trx) => {
        const conversation = await load(trx, actor, conversationId, false);
        const message = await messages.findById(trx, conversation.id, messageId);
        if (!message) throw new NotFoundError({ detail: "Mensagem não encontrada." });
        if (!canReport("PROFESSIONAL", message.side)) throw new ValidationError([{ field: "messageId", message: "só se denuncia uma mensagem do outro lado" }], { detail: "Dados inválidos." });
        const reason = REPORT_REASONS.find((r) => r === input.reason);
        if (!reason) throw new ValidationError([{ field: "reason", message: "motivo inválido" }], { detail: "Dados inválidos." });
        const note = validateReportNote(input.note);
        if (!note.ok) throw invalid("note", note.error);

        await conversations.acquireLocks(trx, [`message-report:${message.id}:PROFESSIONAL`]);
        const existing = await reports.findBySide(trx, message.id, "PROFESSIONAL");
        if (existing) return { created: false, receipt: { id: existing.id, status: existing.status, reason: existing.reason, createdAt: existing.createdAt.toISOString() } };
        const at = now();
        enforce(checkReportLimit((await reports.professionalReportTimes(trx, actor.professionalId, new Date(at.getTime() - DAY_MS))).map((d) => d.getTime()), at.getTime()));
        const report = { id: newId(), messageId: message.id, reporterSide: "PROFESSIONAL" as const, reason, note: note.note, status: "OPEN" as const, createdAt: at };
        await reports.insert(trx, report);
        await deps.audit.record(trx, { occurredAt: at, actorType: "PROFESSIONAL_ACCOUNT", actorProfessionalAccountId: actor.professionalAccountId, action: "PROFESSIONAL_MESSAGE_REPORT_CREATE", resourceType: "MessageReport", resourceId: report.id, result: "SUCCESS", requestId: context.requestId, ...auditContextFields(context), metadata: { reason } });
        return { created: true, receipt: { id: report.id, status: "OPEN" as const, reason, createdAt: at.toISOString() } };
      });
    },
  };
}

export type ProfessionalMessaging = ReturnType<typeof createProfessionalMessaging<unknown>>;
