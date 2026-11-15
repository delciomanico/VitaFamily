// Raiz do módulo `processes` (ADR-015/conventions.md §1; ADR-032, marco B fatia 1; modules.md §3 nota 29).
// `Process` = agregador de leitura: um id por ato (consulta/exame com ids Vita) e um estado simples para a
// família, DERIVADO por `deriveFamilyStatus`. Depende só de `access` e `audit`. NENHUM módulo o importa: os
// donos dos atos falam com ele pelas portas `ProcessLinker` (definida em cada dono, implementada aqui) e
// `ProcessFacts` (definida aqui, implementada pelos donos), ligadas em `main/api.ts`.
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AccessModule } from "../access/index.js";
import type { AuditModule } from "../audit/index.js";
import { createDescribeForAlertsUseCase, type ProcessAlertTarget } from "./application/describe-for-alerts.js";
import { createGetClinicProcessUseCase } from "./application/get-clinic-process.js";
import { createGetProcessUseCase } from "./application/get-process.js";
import { createDiscardProcessUseCase, createFindProcessForClinicUseCase, createOpenProcessUseCase } from "./application/link-process.js";
import { createListProcessesUseCase } from "./application/list-processes.js";
import type { DiscardProcessInput, OpenProcessInput, ProcessFacts, ProcessesDeps } from "./application/ports.js";
import { KyselyProcessesRepository } from "./infrastructure/repo.js";
import { createProcessesClinicPortalRouter } from "./interface/clinic-portal-router.js";
import { createProcessesRouter } from "./interface/router.js";

export type { ActFact, ActPhase, CoverageFact, CoveragePhase, FamilyStatus, NextStep, ProcessOriginType } from "./domain/process.js";
export type { ProcessAlertTarget } from "./application/describe-for-alerts.js";
export type { ActFactEntry, ActFactRef, CoverageFactEntry, DiscardProcessInput, OpenProcessInput, ProcessActor, ProcessFacts } from "./application/ports.js";

export interface ProcessesModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  access: AccessModule;
  /** Ligada em `main/api.ts` aos módulos donos dos atos (adaptador composto). */
  facts: ProcessFacts<Kysely<Database>>;
  /** BR-PRC-09: log técnico sem dados de saúde. */
  onInconsistency: ProcessesDeps<Kysely<Database>>["onInconsistency"];
  clock: Clock;
}

export interface ProcessesModule {
  /** Implementação de `ProcessLinker` (porta definida em cada módulo dono): corre na transação do ato. */
  linker: {
    open: (trx: Kysely<Database>, input: OpenProcessInput) => Promise<{ processId: string }>;
    discard: (trx: Kysely<Database>, input: DiscardProcessInput) => Promise<void>;
    /** Fatia 3: só leitura, para validar o `processId` de um pedido de autorização (porta de `insurer-ops`). */
    findForClinic: (trx: Kysely<Database>, input: { clinicId: string; processId: string }) => Promise<{ processId: string; familyId: string; memberId: string } | null>;
  };
  /** Fatia 5 (ADR-036): dono e «aberto» de cada processo, para `alerts` (porta `ProcessTargets`); leitura de sistema, sem ator. */
  describeForAlerts: (trx: Kysely<Database>, processIds: string[]) => Promise<ProcessAlertTarget[]>;
  /** `/families/{f}/members/{m}/processes*`. */
  router: Router;
  /** `/clinic-portal/processes/{processId}`. */
  clinicPortalRouter: Router;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createProcessesModule(deps: ProcessesModuleDeps): ProcessesModule {
  const processesDeps: ProcessesDeps<Kysely<Database>> = {
    repo: new KyselyProcessesRepository(),
    facts: deps.facts,
    policy: deps.access.policy,
    audit: deps.audit,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
    onInconsistency: deps.onInconsistency,
  };

  return {
    linker: { open: createOpenProcessUseCase(processesDeps), discard: createDiscardProcessUseCase(processesDeps), findForClinic: createFindProcessForClinicUseCase(processesDeps) },
    describeForAlerts: createDescribeForAlertsUseCase(processesDeps),
    router: createProcessesRouter({ listProcesses: createListProcessesUseCase(processesDeps), getProcess: createGetProcessUseCase(processesDeps) }),
    clinicPortalRouter: createProcessesClinicPortalRouter({ getClinicProcess: createGetClinicProcessUseCase(processesDeps) }),
  };
}
