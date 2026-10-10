// Portas do módulo `prescriptions` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir da API pública de `access`, `medications`,
// `documents` (modules.md §2: `prescriptions` depende de `access`, `medications`, `documents`,
// `audit`). Genéricas em `Trx` para que esta camada nunca importe "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Document, ResourceType } from "../../documents/index.js";
import type { CreateMedicationPlanInput, CreateMedicationPlanOptions, MedicationPlan } from "../../medications/index.js";
import type { Prescription, PrescriptionStatus } from "../domain/prescription.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/** Subconjunto de `AccessPolicy<Trx>` que `prescriptions` chama pela raiz (`access.policy`, modules.md §2). */
export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

/**
 * Subconjunto da API pública de `medications` que `prescriptions` chama pela raiz (modules.md §3.6:
 * "a orquestração fica em `prescriptions`, que chama `medications`" — nunca o inverso, evita o
 * ciclo proibido). Todas recebem `trx` já aberto (mesma transação da escrita em `prescriptions`).
 */
export interface MedicationsPort<Trx> {
  createPlan(
    trx: Trx,
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    input: CreateMedicationPlanInput,
    context: RequestContext,
    options?: CreateMedicationPlanOptions,
  ): Promise<MedicationPlan>;
  listPlansForPrescription(trx: Trx, familyId: string, memberId: string, prescriptionId: string): Promise<MedicationPlan[]>;
  endPlansForPrescription(trx: Trx, familyId: string, memberId: string, prescriptionId: string, endedAt: Date): Promise<void>;
}

/**
 * Subconjunto da API pública de `documents` que `prescriptions` chama pela raiz (modules.md §2) —
 * documentos de uma receita (BR-RX-06: eliminar a receita apaga também os documentos).
 */
export interface DocumentsPort<Trx> {
  listForResource(trx: Trx, familyId: string, memberId: string, resourceType: ResourceType, resourceId: string): Promise<Document[]>;
  deleteAllForResource(trx: Trx, familyId: string, memberId: string, resourceType: ResourceType, resourceId: string): Promise<void>;
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

export interface NewPrescriptionRecord {
  id: string;
  familyId: string;
  memberId: string;
  issuedOn: string;
  doctorName?: string;
  notes?: string;
  createdAt: Date;
}

export interface PrescriptionChanges {
  issuedOn?: string;
  doctorName?: string | null;
  notes?: string | null;
}

export interface PrescriptionListFilter {
  status?: PrescriptionStatus;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** `prescriptions` (schema.md §3) — propriedade exclusiva deste módulo (conventions.md §3.5). */
export interface PrescriptionsRepository<Trx> {
  insert(trx: Trx, record: NewPrescriptionRecord): Promise<Prescription>;
  findById(trx: Trx, familyId: string, memberId: string, prescriptionId: string): Promise<Prescription | null>;
  listByMember(trx: Trx, familyId: string, memberId: string, filter: PrescriptionListFilter, limit: number, cursor?: string): Promise<CursorPage<Prescription>>;
  update(trx: Trx, familyId: string, memberId: string, prescriptionId: string, changes: PrescriptionChanges): Promise<Prescription>;
  updateStatus(trx: Trx, familyId: string, memberId: string, prescriptionId: string, status: PrescriptionStatus): Promise<Prescription>;
  delete(trx: Trx, familyId: string, memberId: string, prescriptionId: string): Promise<void>;
}

export interface PrescriptionsDeps<Trx> {
  prescriptionsRepo: PrescriptionsRepository<Trx>;
  policy: AccessPolicyPort<Trx>;
  medications: MedicationsPort<Trx>;
  documents: DocumentsPort<Trx>;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

export type { Prescription, PrescriptionStatus } from "../domain/prescription.js";
// Reexportados para `interface` (dto.ts/router.ts) nunca importar `medications/index.js`
// diretamente — "só application e a raiz chamam outros módulos" (architecture-rules.ts).
export type { CreateMedicationPlanInput, CreateMedicationPlanOptions, MedicationPlan } from "../../medications/index.js";
