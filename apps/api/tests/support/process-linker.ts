// `ProcessLinker` REAL (repo Kysely + auditoria real) para os testes de integração que montam à mão as `deps` de
// `appointments`/`examinations` sobre PostgreSQL (marco B fatia 1): os atos abrem o seu Process como em produção.
// Só `open`/`discard` são usados; as portas de leitura ficam inertes.
import type { Kysely } from "kysely";
import { SystemClock } from "../../src/platform/clock/index.js";
import { withTransaction, type Database } from "../../src/platform/db/index.js";
import { KyselyAuditRepository } from "../../src/modules/audit/infrastructure/repo.js";
import { createDiscardProcessUseCase, createOpenProcessUseCase } from "../../src/modules/processes/application/link-process.js";
import type { ProcessesDeps } from "../../src/modules/processes/application/ports.js";
import { KyselyProcessesRepository } from "../../src/modules/processes/infrastructure/repo.js";

export function createRealProcessLinker(db: Kysely<Database>) {
  const deps: ProcessesDeps<Kysely<Database>> = {
    repo: new KyselyProcessesRepository(),
    facts: { getActFacts: () => Promise.resolve([]), getCoverageFacts: () => Promise.resolve([]) },
    policy: { can: () => Promise.reject(new Error("não usado")) },
    audit: new KyselyAuditRepository(),
    withTransaction: (fn) => withTransaction(db, fn),
    clock: new SystemClock(),
    onInconsistency: () => undefined,
  };
  return { open: createOpenProcessUseCase(deps), discard: createDiscardProcessUseCase(deps) };
}
