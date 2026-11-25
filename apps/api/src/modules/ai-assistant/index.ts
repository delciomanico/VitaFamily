// Raiz do módulo `ai-assistant` (M18, ADR-039, ADR-015; modules.md nota 40): única API pública importável (só por `main/`) e composition root do
// módulo. Importa apenas `audit` e `platform`; acesso, membros, Resumo de saúde e catálogo entram por PORTAS ligadas em `main/api.ts`.
// Sem fornecedor de IA no servidor (a chamada vive no dispositivo, BR-AI-01) e sem sintomas, respostas nem chaves em lado nenhum.
import type { Router } from "express";
import type { Kysely } from "kysely";
import { withTransaction, type Database } from "../../platform/db/index.js";
import { newId } from "../../platform/ids/index.js";
import type { RateLimiter } from "../../platform/rate-limit/async.js";
import type { AuditModule } from "../audit/index.js";
import { createAiConsents } from "./application/consents.js";
import { createAiSessions } from "./application/sessions.js";
import type { AiAccess, AiAssistantDeps, AiMembers, AiSpecialties, AiSummarySource, Clock } from "./application/ports.js";
import { KyselyAiConsentRepository } from "./infrastructure/repo.js";
import { HmacAiTokenSigner } from "./infrastructure/token-signer.js";
import { createAiAssistantRouter } from "./interface/router.js";

export * from "./domain/index.js";
export type { AiAccess, AiMembers, AiSpecialties, AiSummarySource } from "./application/ports.js";

type Trx = Kysely<Database>;

export interface AiAssistantModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  clock: Clock;
  /** Porta assíncrona (ADR-038), namespace `ai-assistant`; injetada pela composição. */
  rateLimiter: RateLimiter;
  /** `AI_SESSION_SECRET` (≥ 32 caracteres). */
  sessionSecret: string;
  access: AiAccess<Trx>;
  members: AiMembers<Trx>;
  summary: AiSummarySource;
  specialties: AiSpecialties;
}

export interface AiAssistantModule {
  /** `/families/{f}/members/{m}/ai/*` e `/ai/guardrails` (User autenticado). Só se monta com `AI_ASSISTANT_ENABLED=true`. */
  router: Router;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createAiAssistantModule(deps: AiAssistantModuleDeps): AiAssistantModule {
  const aiDeps: AiAssistantDeps<Trx> = {
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    rateLimiter: deps.rateLimiter,
    audit: deps.audit,
    access: deps.access,
    members: deps.members,
    summary: deps.summary,
    specialties: deps.specialties,
    signer: new HmacAiTokenSigner(deps.sessionSecret),
    consents: new KyselyAiConsentRepository(),
    newId,
  };
  return { router: createAiAssistantRouter(createAiConsents(aiDeps), createAiSessions(aiDeps)) };
}
