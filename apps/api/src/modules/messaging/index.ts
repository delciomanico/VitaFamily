// Raiz do módulo `messaging` (MK2, ADR-037, modules.md nota 36(c)): conversas família ↔ profissional. S6: lado da família (repositórios,
// casos de uso e as 9 rotas `/families/{f}/members/{m}/conversations*`). Nenhum módulo importa `messaging` (só `main/`); `messaging` só
// importa `audit` (+ `platform`): acesso, profissionais, alertas e e-mail entram por PORTAS ligadas em `main/api.ts` (ADR-016).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import { withTransaction, type Database } from "../../platform/db/index.js";
import { newId } from "../../platform/ids/index.js";
import type { AuditModule } from "../audit/index.js";
import type PgBoss from "pg-boss";
import { createFamilyMessaging, type FamilyMessaging } from "./application/family-conversations.js";
import { createProfessionalMessaging, type ProfessionalMessaging } from "./application/professional-conversations.js";
import { createNotifyProfessional, type NotifyProfessional } from "./application/notify-professional.js";
import type { ConversationAccess, MessageAlerts, MessagingDeps, ProfessionalLookup, ProfessionalMailer, ProfessionalNoticeQueue } from "./application/ports.js";
import { PgBossProfessionalNoticeQueue, registerNotifyProfessionalWorker } from "./infrastructure/jobs.js";
import { KyselyConversationRepository, KyselyMessageRepository, KyselyReportRepository } from "./infrastructure/repo.js";
import { createFamilyMessagingRouter } from "./interface/family-router.js";
import { createProfessionalMessagingRouter } from "./interface/professional-router.js";

export { SmtpProfessionalMailer } from "./infrastructure/mailer-smtp.js";
export { PgBossProfessionalNoticeQueue };
export type { ConversationAccess, MessageAlerts, MessagingClock, ProfessionalIdentity, ProfessionalLookup, ProfessionalMailer, ProfessionalNoticeQueue } from "./application/ports.js";
export { canSend, closeConversation, reopenConversation, sendBlock } from "./domain/conversation.js";
export type { ConversationState, Side } from "./domain/conversation.js";

export interface MessagingModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  access: ConversationAccess<Kysely<Database>>;
  professionals: ProfessionalLookup;
  alerts: MessageAlerts<Kysely<Database>>;
  noticeQueue: ProfessionalNoticeQueue;
}

export interface MessagingModule {
  /** `/families/{f}/members/{m}/conversations*` (User autenticado; ação `MESSAGE_PROFESSIONALS`). */
  router: Router;
  familyUseCases: FamilyMessaging;
  /** `/professional-portal/conversations*` (token de `ProfessionalAccount`; MK2 S8). */
  professionalRouter: Router;
  professionalUseCases: ProfessionalMessaging;
}

export function createMessagingModule(deps: MessagingModuleDeps): MessagingModule {
  const messagingDeps: MessagingDeps<Kysely<Database>> = {
    conversations: new KyselyConversationRepository(),
    messages: new KyselyMessageRepository(),
    reports: new KyselyReportRepository(),
    access: deps.access,
    professionals: deps.professionals,
    alerts: deps.alerts,
    noticeQueue: deps.noticeQueue,
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    newId,
  };
  const familyUseCases = createFamilyMessaging<Kysely<Database>>(messagingDeps);
  const professionalUseCases = createProfessionalMessaging<Kysely<Database>>(messagingDeps);
  return { router: createFamilyMessagingRouter(familyUseCases), familyUseCases, professionalRouter: createProfessionalMessagingRouter(professionalUseCases), professionalUseCases };
}

export interface MessagingWorkerModuleDeps {
  db: Kysely<Database>;
  clock: Clock;
  boss: PgBoss;
  /** Só `getNotificationEmail` (ligado em `main/worker.ts` à raiz de `professionals`). */
  professionals: Pick<ProfessionalLookup, "getNotificationEmail">;
  mailer: ProfessionalMailer;
}

export interface MessagingWorkerModule {
  notifyProfessional: NotifyProfessional;
  /** Regista `messaging.notify-professional` (aviso genérico por e-mail, ≤ 1 cada 30 min por conversa). */
  registerWorkers: () => Promise<void>;
}

/** Composition root do processo "worker" (main/worker.ts). */
export function createMessagingWorkerModule(deps: MessagingWorkerModuleDeps): MessagingWorkerModule {
  const notifyProfessional = createNotifyProfessional<Kysely<Database>>({
    conversations: new KyselyConversationRepository(),
    professionals: deps.professionals,
    mailer: deps.mailer,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  });
  return {
    notifyProfessional,
    registerWorkers: async () => {
      await registerNotifyProfessionalWorker(deps.boss, notifyProfessional);
    },
  };
}
