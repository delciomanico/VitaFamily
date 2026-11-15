// Portas do módulo `processes` (conventions.md §3.2; modules.md §3 nota 29). Genéricas em `Trx` para que
// esta camada nunca importe "kysely" (conventions.md §3.9). `processes` depende só de `access` e `audit`;
// os factos dos atos entram por `ProcessFacts` (implementada por `appointments`/`examinations` e ligada em
// `main/api.ts`) — nunca por import dos módulos donos (BR-PRC-04).
import type { Clock } from "../../../platform/clock/index.js";
import type { KeysetCursor } from "../../../platform/page/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { ActFact, CoverageFact, OriginCategory, Process, ProcessKind, ProcessOriginType } from "../domain/process.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/** Ator do portal da clínica (ADR-020): só o que `application` precisa (a leitura é da `interface`). */
export interface ClinicPortalActor {
  clinicAccountId: string;
  clinicId: string;
  role: "CLINIC_ADMIN" | "CLINIC_MANAGER" | "CLINIC_DOCTOR";
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

/** Quem abriu/apagou o ato (audit.md §3): o ator do fluxo que o módulo dono já tem à mão. */
export interface ProcessActor {
  actorType: "USER" | "CLINIC_ACCOUNT";
  actorUserId?: string;
  actorClinicAccountId?: string;
  requestId: string;
  ip?: string;
  userAgent?: string;
}

/** Entrada de `ProcessLinker.open` (UC-PRC-01): idempotente por `(originType, originId)`. */
export interface OpenProcessInput {
  familyId: string;
  memberId: string;
  originType: ProcessOriginType;
  originId: string;
  clinicId?: string;
  by: ProcessActor;
}

/** Entrada de `ProcessLinker.discard` (UC-PRC-02). */
export interface DiscardProcessInput {
  originType: ProcessOriginType;
  originId: string;
  by: ProcessActor;
}

/** Referência a um ato; a porta de factos trabalha em lote (sem N+1). */
export interface ActFactRef {
  originType: ProcessOriginType;
  originId: string;
}

export interface ActFactEntry extends ActFactRef {
  fact: ActFact;
}

export interface CoverageFactEntry {
  processId: string;
  fact: CoverageFact;
}

/**
 * Porta de leitura (BR-PRC-04): o estado dos atos como `ActFact`. Atos inexistentes (ou com estado
 * inválido) não aparecem no resultado — `processes` trata-os como "sem ato legível" (BR-PRC-09).
 */
export interface ProcessFacts<Trx> {
  /** Só para origens com ato (`APPOINTMENT`/`EXAMINATION`). */
  getActFacts(trx: Trx, familyId: string, refs: ActFactRef[]): Promise<ActFactEntry[]>;
  /**
   * Fatia 3 (ADR-034): facto de cobertura dos pedidos de autorização ligados aos processos (`insurer_authorizations.process_id`),
   * em lote (sem N+1). Processo sem pedidos não aparece no resultado.
   */
  getCoverageFacts(trx: Trx, familyId: string, processIds: string[]): Promise<CoverageFactEntry[]>;
}

export interface NewProcessRecord {
  id: string;
  familyId: string;
  memberId: string;
  kind: ProcessKind;
  originType: ProcessOriginType;
  originId: string;
  clinicId?: string;
  openedAt: Date;
}

export interface ProcessListFilter {
  /** Origens legíveis pelo ator, já intersetadas com `originType` do pedido; nunca vazio. */
  originTypes: ProcessOriginType[];
  /** Posição após a qual continuar (`createdAt` = `openedAt` em ISO). */
  after?: KeysetCursor;
}

/** `processes` (schema.md §4b) — propriedade exclusiva deste módulo. Todas as leituras exigem `familyId` (conventions §3.4). */
export interface ProcessesRepository<Trx> {
  /** `INSERT … ON CONFLICT (origin_type, origin_id) DO NOTHING`: `created=false` devolve o existente. */
  insertIfAbsent(trx: Trx, record: NewProcessRecord): Promise<{ process: Process; created: boolean }>;
  /** Apaga o processo do ato; devolve-o (para a auditoria) ou `null` se já não existia. */
  deleteByOrigin(trx: Trx, originType: ProcessOriginType, originId: string): Promise<Process | null>;
  findOfMember(trx: Trx, familyId: string, memberId: string, processId: string): Promise<Process | null>;
  /** `openedAt` desc, `id` desc; até `limit` linhas e se há mais (busca `limit + 1`). */
  listOfMember(trx: Trx, familyId: string, memberId: string, filter: ProcessListFilter, limit: number): Promise<{ rows: Process[]; hasMore: boolean }>;
  /** Fatia 5 (ADR-036): leitura de sistema (job `alerts.scan` e alertas por evento) pelos ids; sem ator, só dono e ids. */
  findByIds(trx: Trx, processIds: string[]): Promise<Process[]>;
  /** BR-PRC-06: só se `clinic_id` é a clínica do token. */
  findOfClinic(trx: Trx, clinicId: string, processId: string): Promise<Process | null>;
}

export interface ProcessesDeps<Trx> {
  repo: ProcessesRepository<Trx>;
  facts: ProcessFacts<Trx>;
  policy: AccessPolicyPort<Trx>;
  audit: AuditPort<Trx>;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
  /** BR-PRC-09: processo sem ato legível; o adaptador regista em log técnico SEM dados de saúde. */
  onInconsistency: (info: { processId: string; originType: ProcessOriginType }) => void;
}

export type { OriginCategory };
