// Raiz do módulo `audit` (ADR-015/conventions.md §1): única API pública importável por outros
// módulos. Sem papel de "interface" HTTP — a auditoria não tem endpoint no MVP (audit.md regra 4).
import type { Router } from "express";
import type { Kysely } from "kysely";
import { SystemClock, type Clock } from "../../platform/clock/index.js";
import { withTransaction, type Database } from "../../platform/db/index.js";
import { InMemoryRateLimiter } from "../../platform/rate-limit/index.js";
import { createListClinicAuditUseCase } from "./application/list-clinic-audit.js";
import { KyselyAuditMaintenanceRepository, KyselyAuditRepository, KyselyClinicAuditReader } from "./infrastructure/repo.js";
import { createClinicAuditRouter } from "./interface/clinic-audit-router.js";

export type { AuditEvent, AuditAction, AuditActorType, AuditResult } from "./domain/event.js";
export { auditContextFields } from "./domain/event.js";
export type { AuditRepository, AuditMaintenanceRepository } from "./application/ports.js";

export interface AuditModuleDeps {
  /**
   * Ligação usada pelas operações de manutenção (fora de transações de negócio). Em M1 ainda é a
   * mesma ligação da aplicação (`DATABASE_URL`); audit.md regra 1 só com `INSERT` para a app, pelo
   * que `purgeOlderThan`/`anonymizeUser` devem passar a usar `DATABASE_MAINTENANCE_URL` (já
   * presente em `platform/config`, mas por agora sem nenhuma chamada real — ninguém invoca estas
   * duas funções em M1; isso é o job `audit.purge`/a eliminação de conta, ambos M9).
   */
  db: Kysely<Database>;
  /** Relógio (limite de pedidos e janela da auditoria da clínica); omissão: relógio do sistema. */
  clock?: Clock;
}

export interface AuditModule {
  /** `GET /clinic-portal/audit` (M14 R, BR-CLN-40; exceção estreita a P7 ratificada em OP-42). */
  clinicPortalRouter: Router;
  /** `audit.record(trx, event)` — mesma transação da ação (audit.md regra 3). */
  record: KyselyAuditRepository["record"];
  /** Retenção de 24 meses (audit.md regra 6); chamado pelo job `audit.purge` (modules.md §5). */
  purgeOlderThan: (cutoff: Date) => Promise<number>;
  /** Anonimização ao eliminar um User (audit.md regra 5, ADR-011). */
  anonymizeUser: (userId: string) => Promise<number>;
}

/** Composition root chama isto uma vez por processo (main/api.ts, main/worker.ts). */
export function createAuditModule(deps: AuditModuleDeps): AuditModule {
  const repo = new KyselyAuditRepository();
  const maintenance = new KyselyAuditMaintenanceRepository(deps.db);
  const clock = deps.clock ?? new SystemClock();
  const listClinicAudit = createListClinicAuditUseCase({
    reader: new KyselyClinicAuditReader(),
    withTransaction: (fn) => withTransaction(deps.db, fn),
    limiter: new InMemoryRateLimiter(clock),
    clock,
  });
  return {
    clinicPortalRouter: createClinicAuditRouter({ listClinicAudit }),
    record: (trx, event) => repo.record(trx, event),
    purgeOlderThan: (cutoff) => maintenance.purgeOlderThan(cutoff),
    anonymizeUser: (userId) => maintenance.anonymizeUser(userId),
  };
}
