// Portas do módulo `medications` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir da API pública de `access` (modules.md §2:
// `medications` depende de `access`, `audit`). Genéricas em `Trx` para que esta camada nunca
// importe "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { DoseOccurrence, DoseStatus } from "../domain/dose-occurrence.js";
import type { MedicationPlan, PlanStatus, ScheduleType } from "../domain/medication-plan.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/**
 * Subconjunto de `AccessPolicy<Trx>` que `medications` chama pela raiz (`access.policy`,
 * modules.md §2) — reconstruído a partir dos tipos exportados por `access/index.js`, mesmo critério
 * de `health-records`/`documents`.
 */
export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

/**
 * `access.getEffectiveTimezone` (modules.md §2 nota 10): fuso efetivo do sujeito (Q8/DM6,
 * BR-MED-08) — `medications` nunca depende de `families` diretamente, só desta função já exposta
 * por `access` (que depende de `families`).
 */
export interface TimezonePort<Trx> {
  getEffectiveTimezone(trx: Trx, familyId: string, memberId: string): Promise<string>;
}

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface NewMedicationPlanRecord {
  id: string;
  familyId: string;
  memberId: string;
  prescriptionId?: string;
  name: string;
  dosage: string;
  scheduleType: ScheduleType;
  times?: string[];
  daysOfWeek?: number[];
  intervalHours?: number;
  startAt: Date;
  endAt?: Date;
  continuous: boolean;
  notes?: string;
  createdAt: Date;
}

/** `undefined` = não altera; `null` = limpar o campo (BR-RX-05: só afeta o plano em si, não o passado). */
export interface MedicationPlanChanges {
  name?: string;
  dosage?: string;
  scheduleType?: ScheduleType;
  times?: string[] | null;
  daysOfWeek?: number[] | null;
  intervalHours?: number | null;
  endAt?: Date | null;
  continuous?: boolean;
  notes?: string | null;
}

export interface MedicationPlanListFilter {
  status?: PlanStatus;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** `medication_plans` (schema.md §3) — propriedade exclusiva de `medications` (conventions.md §3.5). */
export interface MedicationPlansRepository<Trx> {
  insert(trx: Trx, record: NewMedicationPlanRecord): Promise<MedicationPlan>;
  findById(trx: Trx, familyId: string, memberId: string, planId: string): Promise<MedicationPlan | null>;
  listByMember(trx: Trx, familyId: string, memberId: string, filter: MedicationPlanListFilter, limit: number, cursor?: string): Promise<CursorPage<MedicationPlan>>;
  listByPrescription(trx: Trx, familyId: string, memberId: string, prescriptionId: string): Promise<MedicationPlan[]>;
  update(trx: Trx, familyId: string, memberId: string, planId: string, changes: MedicationPlanChanges): Promise<MedicationPlan>;
  updateStatus(trx: Trx, familyId: string, memberId: string, planId: string, status: PlanStatus, endedAt: Date | null): Promise<MedicationPlan>;
  delete(trx: Trx, familyId: string, memberId: string, planId: string): Promise<void>;
  /** `medications.generate-doses` (job diário, modules.md §5): todos os planos ACTIVE ainda em
   * vigência (`end_at IS NULL OR end_at > now`), de todas as famílias — operação de sistema, sem
   * `familyId` (não há isolamento a preservar: não responde a nenhum pedido de um utilizador). */
  listActiveForGeneration(trx: Trx, now: Date): Promise<MedicationPlan[]>;
}

export interface NewDoseOccurrenceRecord {
  id: string;
  familyId: string;
  memberId: string;
  planId: string;
  scheduledAt: Date;
  generationVersion: number;
  createdAt: Date;
}

export interface DoseListFilter {
  from?: Date;
  to?: Date;
  status?: DoseStatus;
  planId?: string;
}

export interface AdherenceItem {
  planId: string;
  medicationName: string;
  taken: number;
  notTaken: number;
  unconfirmed: number;
  pending: number;
}

/** `dose_occurrences` (schema.md §3) — propriedade exclusiva de `medications`. */
export interface DoseOccurrencesRepository<Trx> {
  /** Insere as ocorrências que ainda não existem para `(planId, scheduledAt)` (ON CONFLICT DO
   * NOTHING, DM5: idempotente — nunca duplica). */
  insertMany(trx: Trx, records: NewDoseOccurrenceRecord[]): Promise<void>;
  /** Ocorrências do plano com `scheduledAt > after` (qualquer estado) — para decidir o que já
   * existe antes de regenerar (BR-RX-05/BR-MED-08: não duplicar, não perder histórico). */
  listFutureByPlan(trx: Trx, planId: string, after: Date): Promise<DoseOccurrence[]>;
  /** Remove ocorrências PENDING futuras do plano cujo `scheduledAt` já não faz parte do novo
   * desenho (nunca toca em TAKEN/NOT_TAKEN/UNCONFIRMED — histórico preservado). */
  deletePendingNotIn(trx: Trx, planId: string, after: Date, keep: Date[]): Promise<void>;
  /** Remove TODAS as ocorrências PENDING futuras do plano (plano terminado/eliminado, UC-MED-04/UC-RX-04). */
  deleteAllFuturePending(trx: Trx, planId: string, after: Date): Promise<void>;
  findById(trx: Trx, familyId: string, memberId: string, doseId: string): Promise<DoseOccurrence | null>;
  listByMember(trx: Trx, familyId: string, memberId: string, filter: DoseListFilter, limit: number, cursor?: string): Promise<CursorPage<DoseOccurrence>>;
  updateStatus(
    trx: Trx,
    doseId: string,
    status: DoseStatus,
    actedAt: Date | null,
    actedByUserId: string | null,
    note: string | null,
  ): Promise<DoseOccurrence>;
  /** `medications.mark-unconfirmed` (job, a cada 5 min): PENDING com `scheduled_at <= threshold`. */
  listPendingBefore(trx: Trx, threshold: Date, limit: number): Promise<DoseOccurrence[]>;
  adherenceByMember(trx: Trx, familyId: string, memberId: string, from: Date, to: Date): Promise<AdherenceItem[]>;
}

export interface MedicationsDeps<Trx> {
  plansRepo: MedicationPlansRepository<Trx>;
  dosesRepo: DoseOccurrencesRepository<Trx>;
  policy: AccessPolicyPort<Trx>;
  timezone: TimezonePort<Trx>;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

/** Subconjunto de `MedicationsDeps` que o worker (`generate-doses-job.ts`/`mark-unconfirmed-job.ts`)
 * precisa — nunca `policy` (job de sistema, sem ator a autorizar; mesmo critério de `documents`
 * `ScanDocumentDeps`). */
export type MedicationsWorkerDeps<Trx> = Pick<MedicationsDeps<Trx>, "plansRepo" | "dosesRepo" | "timezone" | "audit" | "withTransaction" | "clock">;

export type { MedicationPlan, PlanStatus, ScheduleType } from "../domain/medication-plan.js";
export type { DoseOccurrence, DoseStatus } from "../domain/dose-occurrence.js";
