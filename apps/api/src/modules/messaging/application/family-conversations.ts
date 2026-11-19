// Casos de uso do lado da FAMÍLIA (UC-MKT-17/18/22/23; BR-MKT-38..48). Todos começam por `ConversationAccess.assertCanMessage`
// (ação `MESSAGE_PROFESSIONALS`: só `SELF`/`TUTOR_OF`) e procuram a conversa por (família, membro, id): qualquer outra ⇒ `NOT_FOUND`
// sem enumeração. Concorrência: a abertura serializa-se por bloqueio consultivo do (membro-sujeito) + utilizador e a escrita por
// bloqueio da LINHA da conversa (`FOR UPDATE`), pelo que `seq` nunca tem lacunas nem repetições e `clientMessageId` repetido nunca duplica.
// Ordem dos bloqueios (sem deadlocks): `conversation-open:*` < `message-user:*` < linha da conversa. Privacidade (BR-MKT-46): erros e
// auditoria nunca levam texto, rótulo nem nota; os erros de validação só nomeiam o campo.
import { DomainError, NotFoundError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import { advanceRead, closeConversation, nextSeq, reopenConversation, sendBlock } from "../domain/conversation.js";
import { checkOpenLimits, checkReportLimit, checkSendLimits, DAY_MS, HOUR_MS } from "../domain/limits.js";
import type { Message } from "../domain/message.js";
import { canReport, REPORT_REASONS, type ReportReason } from "../domain/report.js";
import { validateMessageText, validateParticipantLabel, validateReportNote } from "../domain/text.js";
import { enforce, invalid, parseLimit, type Page } from "./shared.js";
export type { Page };
import { decodeConversationCursor, decodeSeqCursor, encodeConversationCursor, encodeSeqCursor } from "./cursor.js";
import type { ActorIdentity, ConversationRecord, MessagingDeps, ProfessionalIdentity, RequestContext } from "./ports.js";
import { toConversationView, toMessageView, toState, type ChatMessageView, type FamilyConversationView } from "./views.js";

export interface StartConversationInput {
  professionalId: string;
  participantLabel: string;
  text: string;
  clientMessageId?: string;
}

export interface SendMessageInput {
  text: string;
  clientMessageId?: string;
}

export interface ReportInput {
  reason: string;
  note?: string;
}

export function createFamilyMessaging<Trx>(deps: MessagingDeps<Trx>) {
  const { conversations, messages, reports } = deps;
  const now = (): Date => deps.clock.now();

  async function authorize(trx: Trx, actor: ActorIdentity, familyId: string, memberId: string): Promise<void> {
    await deps.access.assertCanMessage(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
  }

  async function identityOf(professionalId: string): Promise<ProfessionalIdentity | undefined> {
    return (await deps.professionals.findIdentities([professionalId]))[0];
  }

  async function loadConversation(trx: Trx, familyId: string, memberId: string, conversationId: string, forUpdate: boolean): Promise<ConversationRecord> {
    const conversation = await conversations.findForFamily(trx, familyId, memberId, conversationId, forUpdate);
    if (!conversation) throw new NotFoundError({ detail: "Conversa não encontrada." });
    return conversation;
  }

  /** Acrescenta uma mensagem da família sob o bloqueio da linha: limites, `seq`, atualização da conversa. */
  async function append(trx: Trx, conversation: ConversationRecord, actor: ActorIdentity, text: string, clientMessageId: string | null): Promise<{ message: Message; conversation: ConversationRecord }> {
    const at = now();
    const nowMs = at.getTime();
    enforce(
      checkSendLimits({
        side: "FAMILY",
        nowMs,
        conversationMessageTimes: (await messages.familyTimesInConversation(trx, conversation.id, new Date(nowMs - HOUR_MS))).map((d) => d.getTime()),
        senderDayMessageTimes: (await messages.senderTimes(trx, actor.userId, new Date(nowMs - DAY_MS))).map((d) => d.getTime()),
        consecutiveFamilyWithoutReply: conversation.lastSeq - conversation.lastProfessionalSeq,
      }),
    );
    const seq = nextSeq(conversation.lastSeq);
    const message: Message = { id: newId(), conversationId: conversation.id, seq, side: "FAMILY", senderUserId: actor.userId, body: text, clientMessageId, hiddenAt: null, createdAt: at };
    await messages.insert(trx, message);
    await conversations.applyMessage(trx, conversation.id, { lastSeq: seq, at, side: "FAMILY" });
    return { message, conversation: { ...conversation, lastSeq: seq, lastMessageAt: at } };
  }

  async function enqueueNotice(conversationId: string): Promise<void> {
    try {
      await deps.noticeQueue.enqueue(conversationId);
    } catch {
      // O aviso ao profissional é «melhor esforço» (o contador no portal é a fonte de verdade); nunca falha o envio.
    }
  }

  return {
    /** UC-MKT-17: abre a conversa do par (membro, profissional) com a 1.ª mensagem, ou acrescenta à existente (`created=false`). */
    async startConversation(actor: ActorIdentity, familyId: string, memberId: string, input: StartConversationInput, context: RequestContext): Promise<{ created: boolean; conversation: FamilyConversationView; message: ChatMessageView }> {
      const result = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const text = validateMessageText(input.text);
        if (!text.ok) throw invalid("text", text.error);
        const label = validateParticipantLabel(input.participantLabel);
        if (!label.ok) throw invalid("participantLabel", label.error);
        const identity = await identityOf(input.professionalId);
        if (!identity?.approved) throw new NotFoundError({ detail: "Profissional não encontrado." });

        await conversations.acquireLocks(trx, [`conversation-open:${familyId}:${memberId}`, `message-user:${actor.userId}`]);
        const existing = await conversations.findByPair(trx, familyId, memberId, input.professionalId);
        const clientMessageId = input.clientMessageId ?? null;

        if (existing) {
          const replay = clientMessageId === null ? null : await messages.findByClientMessageId(trx, existing.id, clientMessageId);
          if (replay) return { created: false, notify: false, conversation: existing, message: replay, identity };
          if (sendBlock(existing, "FAMILY", true) !== null) throw new DomainError("CONVERSATION_CLOSED", { detail: "Esta conversa está fechada." });
          const appended = await append(trx, existing, actor, text.text, clientMessageId);
          return { created: false, notify: true, conversation: appended.conversation, message: appended.message, identity };
        }

        const at = now();
        const nowMs = at.getTime();
        enforce(
          checkOpenLimits({
            nowMs,
            newConversationTimes: (await conversations.newConversationTimes(trx, actor.userId, new Date(nowMs - DAY_MS))).map((d) => d.getTime()),
            openForSubject: await conversations.countOpenForSubject(trx, familyId, memberId),
          }),
        );
        enforce(checkSendLimits({ side: "FAMILY", nowMs, conversationMessageTimes: [], senderDayMessageTimes: (await messages.senderTimes(trx, actor.userId, new Date(nowMs - DAY_MS))).map((d) => d.getTime()), consecutiveFamilyWithoutReply: 0 }));
        const conversation: ConversationRecord = {
          id: newId(),
          familyId,
          memberId,
          professionalId: input.professionalId,
          openedByUserId: actor.userId,
          participantLabel: label.text,
          status: "OPEN",
          closedBy: null,
          closedAt: null,
          lastSeq: 1,
          lastProfessionalSeq: 0,
          lastMessageAt: at,
          familyReadSeq: 0,
          professionalReadSeq: 0,
          professionalNotifiedAt: null,
          createdAt: at,
        };
        await conversations.insert(trx, conversation);
        const message: Message = { id: newId(), conversationId: conversation.id, seq: 1, side: "FAMILY", senderUserId: actor.userId, body: text.text, clientMessageId, hiddenAt: null, createdAt: at };
        await messages.insert(trx, message);
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "CONVERSATION_START",
          resourceType: "Conversation",
          resourceId: conversation.id,
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          ...auditContextFields(context),
          metadata: { professionalId: input.professionalId },
        });
        return { created: true, notify: true, conversation, message, identity };
      });
      if (result.notify) await enqueueNotice(result.conversation.id);
      const unread = result.created ? 0 : await deps.withTransaction((trx) => conversations.unreadForFamily(trx, result.conversation.id, result.conversation.familyReadSeq));
      return { created: result.created, conversation: toConversationView(result.conversation, result.identity, unread), message: toMessageView(result.message, result.conversation, actor.userId) };
    },

    /** UC-MKT-18: lista das conversas do membro (última mensagem primeiro). */
    async listConversations(actor: ActorIdentity, familyId: string, memberId: string, query: { status?: "OPEN" | "CLOSED"; limit?: number; cursor?: string }): Promise<Page<FamilyConversationView>> {
      const limit = parseLimit(query.limit);
      const after = query.cursor === undefined || query.cursor === "" ? undefined : decodeConversationCursor(query.cursor);
      const rows = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        return conversations.listForFamily(trx, familyId, memberId, { limit: limit + 1, ...(query.status ? { status: query.status } : {}), ...(after ? { after } : {}) });
      });
      const page = rows.slice(0, limit);
      const identities = new Map((await deps.professionals.findIdentities([...new Set(page.map((c) => c.professionalId))])).map((i) => [i.id, i] as const));
      const last = page[page.length - 1];
      return { items: page.map((c) => toConversationView(c, identities.get(c.professionalId), c.unreadForFamily)), nextCursor: rows.length > limit && last ? encodeConversationCursor(last.lastMessageAt, last.id) : null };
    },

    async getConversation(actor: ActorIdentity, familyId: string, memberId: string, conversationId: string): Promise<FamilyConversationView> {
      const { conversation, unread } = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const found = await loadConversation(trx, familyId, memberId, conversationId, false);
        return { conversation: found, unread: await conversations.unreadForFamily(trx, found.id, found.familyReadSeq) };
      });
      return toConversationView(conversation, await identityOf(conversation.professionalId), unread);
    },

    /** Mensagens por `seq` decrescente com cursor. NÃO marca como lido (BR-MKT-40). */
    async listMessages(actor: ActorIdentity, familyId: string, memberId: string, conversationId: string, query: { limit?: number; cursor?: string }): Promise<Page<ChatMessageView>> {
      const limit = parseLimit(query.limit);
      const beforeSeq = query.cursor === undefined || query.cursor === "" ? undefined : decodeSeqCursor(query.cursor);
      return deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const conversation = await loadConversation(trx, familyId, memberId, conversationId, false);
        const rows = await messages.listPage(trx, conversation.id, limit + 1, beforeSeq);
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        return { items: page.map((m) => toMessageView(m, conversation, actor.userId)), nextCursor: rows.length > limit && last ? encodeSeqCursor(last.seq) : null };
      });
    },

    /** UC-MKT-18: envio com idempotência por `clientMessageId` (`created=false` = devolve a existente). */
    async sendMessage(actor: ActorIdentity, familyId: string, memberId: string, conversationId: string, input: SendMessageInput): Promise<{ created: boolean; message: ChatMessageView }> {
      const result = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const text = validateMessageText(input.text);
        if (!text.ok) throw invalid("text", text.error);
        await conversations.acquireLocks(trx, [`message-user:${actor.userId}`]);
        const conversation = await loadConversation(trx, familyId, memberId, conversationId, true);
        const clientMessageId = input.clientMessageId ?? null;
        const replay = clientMessageId === null ? null : await messages.findByClientMessageId(trx, conversation.id, clientMessageId);
        if (replay) return { created: false, conversation, message: replay };
        const identity = await identityOf(conversation.professionalId);
        if (sendBlock(conversation, "FAMILY", identity?.approved ?? false) !== null) throw new DomainError("CONVERSATION_CLOSED", { detail: "Esta conversa está fechada." });
        const appended = await append(trx, conversation, actor, text.text, clientMessageId);
        return { created: true, ...appended };
      });
      if (result.created) await enqueueNotice(result.conversation.id);
      return { created: result.created, message: toMessageView(result.message, result.conversation, actor.userId) };
    },

    /** Marcador partilhado entre tutores (BR-MKT-40/41); nunca recua; marca também os alertas da conversa. Idempotente. */
    async markRead(actor: ActorIdentity, familyId: string, memberId: string, conversationId: string, upToSeq: number | undefined): Promise<FamilyConversationView> {
      const { conversation, unread } = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const found = await loadConversation(trx, familyId, memberId, conversationId, true);
        const advanced = advanceRead(toState(found), "FAMILY", upToSeq);
        if (!advanced.ok) throw new ValidationError([{ field: "upToSeq", message: "fora do intervalo da conversa" }], { detail: "Dados inválidos." });
        const familyReadSeq = advanced.state.familyReadSeq;
        if (familyReadSeq !== found.familyReadSeq) await conversations.setFamilyReadSeq(trx, found.id, familyReadSeq, now());
        // Os alertas só se limpam quando a conversa fica lida até ao fim (o `dedupeKey` inclui o marcador, BR-MKT-41).
        if (familyReadSeq >= found.lastSeq) await deps.alerts.markConversationRead(trx, { conversationId: found.id });
        const updated = { ...found, familyReadSeq };
        return { conversation: updated, unread: await conversations.unreadForFamily(trx, found.id, familyReadSeq) };
      });
      return toConversationView(conversation, await identityOf(conversation.professionalId), unread);
    },

    async closeConversation(actor: ActorIdentity, familyId: string, memberId: string, conversationId: string, context: RequestContext): Promise<FamilyConversationView> {
      const { conversation, unread } = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const found = await loadConversation(trx, familyId, memberId, conversationId, true);
        const result = closeConversation(toState(found), "FAMILY");
        if (!result.ok) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A conversa já está fechada." });
        const at = now();
        await conversations.setStatus(trx, found.id, { status: "CLOSED", closedBy: "FAMILY", at });
        await deps.audit.record(trx, { occurredAt: at, actorType: "USER", actorUserId: actor.userId, action: "CONVERSATION_CLOSE", resourceType: "Conversation", resourceId: found.id, familyId, subjectMemberId: memberId, result: "SUCCESS", requestId: context.requestId, ...auditContextFields(context) });
        return { conversation: { ...found, status: "CLOSED" as const, closedBy: "FAMILY" as const, closedAt: at }, unread: await conversations.unreadForFamily(trx, found.id, found.familyReadSeq) };
      });
      return toConversationView(conversation, await identityOf(conversation.professionalId), unread);
    },

    async reopenConversation(actor: ActorIdentity, familyId: string, memberId: string, conversationId: string, context: RequestContext): Promise<FamilyConversationView> {
      const { conversation, unread } = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        await conversations.acquireLocks(trx, [`conversation-open:${familyId}:${memberId}`]);
        const found = await loadConversation(trx, familyId, memberId, conversationId, true);
        const result = reopenConversation(toState(found), "FAMILY");
        if (!result.ok) {
          // Fechada pelo outro lado ou pelo sistema ⇒ `CONVERSATION_CLOSED` (sem revelar quem); aberta ⇒ `INVALID_STATE_TRANSITION`.
          if (found.status === "CLOSED") throw new DomainError("CONVERSATION_CLOSED", { detail: "Esta conversa não pode ser reaberta." });
          throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A conversa já está aberta." });
        }
        const at = now();
        enforce(checkOpenLimits({ nowMs: at.getTime(), newConversationTimes: [], openForSubject: await conversations.countOpenForSubject(trx, familyId, memberId) }));
        await conversations.setStatus(trx, found.id, { status: "OPEN", closedBy: null, at });
        await deps.audit.record(trx, { occurredAt: at, actorType: "USER", actorUserId: actor.userId, action: "CONVERSATION_REOPEN", resourceType: "Conversation", resourceId: found.id, familyId, subjectMemberId: memberId, result: "SUCCESS", requestId: context.requestId, ...auditContextFields(context) });
        return { conversation: { ...found, status: "OPEN" as const, closedBy: null, closedAt: null }, unread: await conversations.unreadForFamily(trx, found.id, found.familyReadSeq) };
      });
      return toConversationView(conversation, await identityOf(conversation.professionalId), unread);
    },

    /** UC-MKT-23: uma denúncia por (mensagem, lado); repetir devolve a existente. Auditoria sem texto nem nota. */
    async reportMessage(actor: ActorIdentity, familyId: string, memberId: string, conversationId: string, messageId: string, input: ReportInput, context: RequestContext): Promise<{ created: boolean; receipt: { id: string; status: "OPEN" | "DECIDED"; reason: ReportReason; createdAt: string } }> {
      return deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const conversation = await loadConversation(trx, familyId, memberId, conversationId, false);
        const message = await messages.findById(trx, conversation.id, messageId);
        if (!message) throw new NotFoundError({ detail: "Mensagem não encontrada." });
        if (!canReport("FAMILY", message.side)) throw new ValidationError([{ field: "messageId", message: "só se denuncia uma mensagem do outro lado" }], { detail: "Dados inválidos." });
        const reason = REPORT_REASONS.find((r) => r === input.reason);
        if (!reason) throw new ValidationError([{ field: "reason", message: "motivo inválido" }], { detail: "Dados inválidos." });
        const note = validateReportNote(input.note);
        if (!note.ok) throw invalid("note", note.error);

        await conversations.acquireLocks(trx, [`message-report:${message.id}:FAMILY`]);
        const existing = await reports.findBySide(trx, message.id, "FAMILY");
        if (existing) return { created: false, receipt: { id: existing.id, status: existing.status, reason: existing.reason, createdAt: existing.createdAt.toISOString() } };
        const at = now();
        enforce(checkReportLimit((await reports.familyReportTimesForSubject(trx, familyId, memberId, new Date(at.getTime() - DAY_MS))).map((d) => d.getTime()), at.getTime()));
        const report = { id: newId(), messageId: message.id, reporterSide: "FAMILY" as const, reason, note: note.note, status: "OPEN" as const, createdAt: at };
        await reports.insert(trx, report);
        await deps.audit.record(trx, { occurredAt: at, actorType: "USER", actorUserId: actor.userId, action: "MESSAGE_REPORT_CREATE", resourceType: "MessageReport", resourceId: report.id, familyId, subjectMemberId: memberId, result: "SUCCESS", requestId: context.requestId, ...auditContextFields(context), metadata: { reason } });
        return { created: true, receipt: { id: report.id, status: "OPEN" as const, reason, createdAt: at.toISOString() } };
      });
    },
  };
}

export type FamilyMessaging = ReturnType<typeof createFamilyMessaging<unknown>>;
