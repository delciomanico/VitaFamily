// Raiz do módulo `messaging` (MK2, ADR-037, modules.md nota 36(c)). S5: só o domínio puro e as portas; casos de uso, repositórios, jobs
// e rotas chegam na S6+. Nenhum módulo importa `messaging` (só `main/`); `messaging` só importa `audit` (+ `platform`).
export type { ConversationAccess, MessageAlerts, MessagingClock, ProfessionalLookup, ProfessionalMailer, PublicProfessional } from "./application/ports.js";
export { canSend, closeConversation, reopenConversation, sendBlock } from "./domain/conversation.js";
export type { ConversationState, Side } from "./domain/conversation.js";
