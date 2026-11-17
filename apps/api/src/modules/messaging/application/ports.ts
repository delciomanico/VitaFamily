// Portas da `application` de `messaging` (ADR-016; modules.md nota 36(c)). `messaging` NÃO importa `auth`, `access`, `families`,
// `professionals`, `notifications`, `alerts`, `admin`, `lifecycle` nem módulos de saúde: tudo o que vem de fora entra por estas portas,
// ligadas em `main/api.ts`. Os repositórios e casos de uso chegam na S6. O conteúdo das mensagens nunca sai por estas portas para logs,
// e-mails nem alertas (BR-MKT-46).
export interface MessagingClock {
  now(): Date;
}

/** Decisão da família sobre a ação `MESSAGE_PROFESSIONALS` (só `SELF`/`TUTOR_OF`; implementada em `main/api.ts` sobre `access`). */
export interface ConversationAccess<Trx> {
  /** Lança `NotFoundError`/`ForbiddenError`/`MEMBER_BLOCKED` em DENY. */
  assertCanMessage(trx: Trx, input: { userId: string; platformAdmin: boolean; familyId: string; memberId: string }): Promise<{ relation: "SELF" | "TUTOR_OF" }>;
  /** Destinatários `SELF`/`TUTOR_OF` do membro-sujeito (para os alertas), sem ids para o profissional. */
  recipientUserIds(trx: Trx, input: { familyId: string; memberId: string }): Promise<string[]>;
}

export interface PublicProfessional {
  id: string;
  displayName: string;
}

/** Profissional lido da raiz `ProfessionalDirectory`, SEM cache do estado (BR-MKT-47). */
export interface ProfessionalLookup {
  findPublic(professionalId: string): Promise<PublicProfessional | null>;
  isApproved(professionalId: string): Promise<boolean>;
  /** Só para o aviso genérico por e-mail (nunca exposto em respostas). */
  getNotificationEmail(professionalId: string): Promise<string | null>;
}

/** Alertas de nova mensagem (implementada sobre `alerts.raiseMessageEvent`/`markSourceRead`). */
export interface MessageAlerts<Trx> {
  raiseMessageReceived(trx: Trx, input: { conversationId: string; familyId: string; memberId: string; familyReadSeq: number }): Promise<void>;
  markConversationRead(trx: Trx, input: { conversationId: string; recipientUserId: string }): Promise<void>;
}

/** Aviso genérico por e-mail ao profissional («Tem uma nova mensagem no Vita»); sem conteúdo, nomes nem ids. */
export interface ProfessionalMailer {
  sendNewMessageNotice(to: string): Promise<void>;
}
