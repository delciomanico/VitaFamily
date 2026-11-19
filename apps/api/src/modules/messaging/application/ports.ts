// Portas da `application` de `messaging` (ADR-016; modules.md nota 36(c)). `messaging` NÃO importa `auth`, `access`, `families`,
// `professionals`, `notifications`, `alerts`, `admin`, `lifecycle` nem módulos de saúde: tudo o que vem de fora entra por estas portas,
// ligadas em `main/api.ts`. O conteúdo das mensagens nunca sai por estas portas para logs, e-mails nem alertas (BR-MKT-46).
import type { AuditEvent } from "../../audit/index.js";
import type { ClosedBy, ConversationStatus } from "../domain/conversation.js";
import type { Message } from "../domain/message.js";
import type { ReportReason, ReportStatus } from "../domain/report.js";

export interface MessagingClock {
  now(): Date;
}

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/** Ator do portal do profissional (token de `ProfessionalAccount`); o estado de validação NÃO vem do token (lê-se por pedido). */
export interface ProfessionalActor {
  professionalId: string;
  professionalAccountId: string;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

/** Decisão da família sobre a ação `MESSAGE_PROFESSIONALS` (só `SELF`/`TUTOR_OF`; implementada em `main/api.ts` sobre `access`). */
export interface ConversationAccess<Trx> {
  /** Lança `NotFoundError`/`ForbiddenError`/`MEMBER_BLOCKED` em DENY. */
  assertCanMessage(trx: Trx, input: { userId: string; platformAdmin: boolean; familyId: string; memberId: string }): Promise<{ relation: "SELF" | "TUTOR_OF" }>;
}

/** Identidade pública de um profissional que já tem conversa (BR-MKT-47: o histórico mantém-se legível mesmo se já não for `APPROVED`). */
export interface ProfessionalIdentity {
  id: string;
  displayName: string;
  city: string | null;
  /** `validation_status = APPROVED` lido AGORA, sem cache (BR-MKT-47). */
  approved: boolean;
}

/** Profissionais lidos da raiz `ProfessionalDirectory`, SEM cache do estado (BR-MKT-47). */
export interface ProfessionalLookup {
  /** Identidades dos ids pedidos (ausentes omitidos). Só a `application` decide o que mostrar; nunca devolve e-mail nem estado detalhado. */
  findIdentities(ids: readonly string[]): Promise<ProfessionalIdentity[]>;
  /** Só para o aviso genérico por e-mail (nunca exposto em respostas). */
  getNotificationEmail(professionalId: string): Promise<string | null>;
}

/** Alertas de nova mensagem (implementada sobre `alerts.raiseMessageEvent`/`markSourceRead`). */
export interface MessageAlerts<Trx> {
  raiseMessageReceived(trx: Trx, input: { conversationId: string; familyId: string; memberId: string; familyReadSeq: number }): Promise<void>;
  /** Marca como lidos os alertas `MESSAGE_RECEIVED` da conversa para TODOS os destinatários (marcador partilhado da família). */
  markConversationRead(trx: Trx, input: { conversationId: string }): Promise<void>;
}

/** Aviso genérico por e-mail ao profissional («Tem uma nova mensagem no Vita»); sem conteúdo, nomes nem ids. */
export interface ProfessionalMailer {
  sendNewMessageNotice(to: string): Promise<void>;
}

/** Fila do aviso ao profissional (job `messaging.notify-professional`); só leva o id da conversa. Chamada DEPOIS do commit. */
export interface ProfessionalNoticeQueue {
  enqueue(conversationId: string): Promise<void>;
}

export interface ConversationRecord {
  id: string;
  familyId: string;
  memberId: string;
  professionalId: string;
  openedByUserId: string | null;
  participantLabel: string;
  status: ConversationStatus;
  closedBy: ClosedBy | null;
  closedAt: Date | null;
  lastSeq: number;
  lastProfessionalSeq: number;
  lastMessageAt: Date;
  familyReadSeq: number;
  professionalReadSeq: number;
  professionalNotifiedAt: Date | null;
  createdAt: Date;
}

export interface ConversationWithUnread extends ConversationRecord {
  /** Mensagens do profissional com `seq` > `familyReadSeq`. */
  unreadForFamily: number;
}

export interface ConversationWithUnreadProfessional extends ConversationRecord {
  /** Mensagens da família com `seq` > `professionalReadSeq`. */
  unreadForProfessional: number;
}

export interface ConversationListFilter {
  status?: ConversationStatus;
  limit: number;
  /** Mantém só as que vêm DEPOIS (ordem `lastMessageAt DESC, id DESC`). */
  after?: { lastMessageAt: Date; id: string };
}

export interface ConversationRepository<Trx> {
  /** Bloqueios consultivos transacionais, adquiridos por ordem de chave (sem deadlocks entre pedidos). */
  acquireLocks(trx: Trx, keys: readonly string[]): Promise<void>;
  findByPair(trx: Trx, familyId: string, memberId: string, professionalId: string): Promise<ConversationRecord | null>;
  /** MK3 (OP-106): `professionalId -> conversationId` das conversas do par (membro, profissional), SEM bloquear linhas. */
  findIdsByProfessionals(trx: Trx, familyId: string, memberId: string, professionalIds: string[]): Promise<Map<string, string>>;
  /** Procurada SEMPRE por (família, membro, id): outra família/membro ⇒ `null` (BR-MKT-48). `forUpdate` bloqueia a linha. */
  findForFamily(trx: Trx, familyId: string, memberId: string, conversationId: string, forUpdate: boolean): Promise<ConversationRecord | null>;
  insert(trx: Trx, record: ConversationRecord): Promise<void>;
  unreadForFamily(trx: Trx, conversationId: string, familyReadSeq: number): Promise<number>;
  listForFamily(trx: Trx, familyId: string, memberId: string, filter: ConversationListFilter): Promise<ConversationWithUnread[]>;
  countOpenForSubject(trx: Trx, familyId: string, memberId: string): Promise<number>;
  /** Criação das conversas novas abertas por este utilizador desde `since`. */
  newConversationTimes(trx: Trx, userId: string, since: Date): Promise<Date[]>;
  /** `side = PROFESSIONAL` atualiza também `lastProfessionalSeq` (base do limite de 3 mensagens da família sem resposta). */
  applyMessage(trx: Trx, conversationId: string, change: { lastSeq: number; at: Date; side: "FAMILY" | "PROFESSIONAL" }): Promise<void>;
  setFamilyReadSeq(trx: Trx, conversationId: string, seq: number, at: Date): Promise<void>;
  setProfessionalReadSeq(trx: Trx, conversationId: string, seq: number, at: Date): Promise<void>;
  /** Lado do PROFISSIONAL: procurada SEMPRE por (professionalId do token, id): de outro profissional ⇒ `null` (BR-MKT-48). */
  findForProfessional(trx: Trx, professionalId: string, conversationId: string, forUpdate: boolean): Promise<ConversationRecord | null>;
  unreadForProfessional(trx: Trx, conversationId: string, professionalReadSeq: number): Promise<number>;
  listForProfessional(trx: Trx, professionalId: string, filter: ConversationListFilter): Promise<ConversationWithUnreadProfessional[]>;
  /**
   * Reserva o aviso ao profissional (BR-MKT-41): só se a última mensagem é da família, o profissional ainda não a leu e não houve aviso
   * nos últimos 30 min. Sob `FOR UPDATE` (jobs repetidos/concorrentes ⇒ um só vence). Devolve o profissional e o carimbo anterior.
   */
  claimProfessionalNotice(trx: Trx, conversationId: string, now: Date): Promise<{ professionalId: string; previous: Date | null } | null>;
  /** Desfaz a reserva se o envio falhou (só se ainda for a nossa), para o *retry* poder avisar. */
  releaseProfessionalNotice(trx: Trx, conversationId: string, claimedAt: Date, previous: Date | null): Promise<void>;
  setStatus(trx: Trx, conversationId: string, change: { status: ConversationStatus; closedBy: ClosedBy | null; at: Date }): Promise<void>;
  /** Retenção (BR-MKT-45): apaga as conversas com `lastMessageAt` ANTERIOR a `before` (mensagens e denúncias em cascata); devolve a contagem. */
  purgeLastMessageBefore(trx: Trx, before: Date): Promise<number>;
}

export interface MessageRepository<Trx> {
  insert(trx: Trx, message: Message): Promise<void>;
  findByClientMessageId(trx: Trx, conversationId: string, clientMessageId: string): Promise<Message | null>;
  findById(trx: Trx, conversationId: string, messageId: string): Promise<Message | null>;
  /** Mais recentes primeiro: `seq` < `beforeSeq` (se dado), até `limit` linhas. */
  listPage(trx: Trx, conversationId: string, limit: number, beforeSeq?: number): Promise<Message[]>;
  /** Carimbos das mensagens FAMILY da conversa desde `since`. */
  familyTimesInConversation(trx: Trx, conversationId: string, since: Date): Promise<Date[]>;
  /** Carimbos das mensagens PROFESSIONAL da conversa desde `since`. */
  professionalTimesInConversation(trx: Trx, conversationId: string, since: Date): Promise<Date[]>;
  /** Carimbos das mensagens do profissional (todas as suas conversas) desde `since`. */
  professionalTimes(trx: Trx, professionalId: string, since: Date): Promise<Date[]>;
  /** Carimbos das mensagens enviadas por este utilizador (todas as conversas) desde `since`. */
  senderTimes(trx: Trx, userId: string, since: Date): Promise<Date[]>;
}

export interface MessageReportRecord {
  id: string;
  messageId: string;
  reporterSide: "FAMILY" | "PROFESSIONAL";
  reason: ReportReason;
  note: string | null;
  status: ReportStatus;
  createdAt: Date;
}

export interface ReportRepository<Trx> {
  findBySide(trx: Trx, messageId: string, side: "FAMILY" | "PROFESSIONAL"): Promise<MessageReportRecord | null>;
  insert(trx: Trx, report: MessageReportRecord): Promise<void>;
  /** Denúncias do lado da família feitas nas conversas deste membro-sujeito desde `since` (não se guarda o denunciante: minimização). */
  /** Denúncias do lado do profissional feitas nas suas conversas desde `since`. */
  professionalReportTimes(trx: Trx, professionalId: string, since: Date): Promise<Date[]>;
  familyReportTimesForSubject(trx: Trx, familyId: string, memberId: string, since: Date): Promise<Date[]>;
}

export interface MessagingDeps<Trx> {
  conversations: ConversationRepository<Trx>;
  messages: MessageRepository<Trx>;
  reports: ReportRepository<Trx>;
  access: ConversationAccess<Trx>;
  professionals: ProfessionalLookup;
  alerts: MessageAlerts<Trx>;
  noticeQueue: ProfessionalNoticeQueue;
  audit: AuditPort<Trx>;
  withTransaction: WithTransaction<Trx>;
  clock: MessagingClock;
  newId: () => string;
}
