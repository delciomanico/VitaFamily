// Portas do módulo `health-records` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir da API pública de `access`/`families`
// (modules.md §2-3: `health-records` depende de `access`, `audit`, `families` — nota 9). Genéricas
// em `Trx` para que esta camada nunca importe "kysely" (banido em domain/application,
// conventions.md §3.9).
import type { AuditEvent } from "../../audit/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, ActorIdentity, CanInput } from "../../access/index.js";
import type { Allergy } from "../domain/allergy.js";
import type { BloodType } from "../domain/blood-type.js";
import type { ConditionKind, MedicalCondition } from "../domain/medical-condition.js";

export type { ActorIdentity };

/**
 * Subconjunto de `AccessPolicy<Trx>` (`access/application/policy.ts`) que `health-records` chama
 * pela raiz (`access.policy`, modules.md §2) — reconstruído aqui a partir dos tipos exportados por
 * `access/index.js` (`CanInput`/`AccessContext`) porque `access` não exporta a própria interface
 * `AccessPolicy` (só o `AccessModule` que a contém); estruturalmente idêntico, sem acoplamento a
 * Kysely.
 */
export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

export interface NewAllergyRecord {
  id: string;
  familyId: string;
  memberId: string;
  name: string;
  notes?: string;
  since?: string;
  createdAt: Date;
}

/** `undefined` = não altera; `null` = limpar o campo (R6: só estado atual, sem versionamento). */
export interface AllergyChanges {
  name?: string;
  notes?: string | null;
  since?: string | null;
}

/** `allergies` (schema.md §3) — propriedade exclusiva de `health-records` (conventions.md §3.5). */
export interface AllergiesRepository<Trx> {
  insert(trx: Trx, record: NewAllergyRecord): Promise<Allergy>;
  findById(trx: Trx, familyId: string, memberId: string, allergyId: string): Promise<Allergy | null>;
  listByMember(trx: Trx, familyId: string, memberId: string): Promise<Allergy[]>;
  update(trx: Trx, familyId: string, memberId: string, allergyId: string, changes: AllergyChanges): Promise<Allergy>;
  delete(trx: Trx, familyId: string, memberId: string, allergyId: string): Promise<void>;
}

export interface NewConditionRecord {
  id: string;
  familyId: string;
  memberId: string;
  name: string;
  kind: ConditionKind;
  notes?: string;
  since?: string;
  until?: string;
  createdAt: Date;
}

export interface ConditionChanges {
  name?: string;
  kind?: ConditionKind;
  notes?: string | null;
  since?: string | null;
  until?: string | null;
}

/** `medical_conditions` (schema.md §3) — propriedade exclusiva de `health-records`. */
export interface MedicalConditionsRepository<Trx> {
  insert(trx: Trx, record: NewConditionRecord): Promise<MedicalCondition>;
  findById(trx: Trx, familyId: string, memberId: string, conditionId: string): Promise<MedicalCondition | null>;
  listByMember(trx: Trx, familyId: string, memberId: string): Promise<MedicalCondition[]>;
  update(trx: Trx, familyId: string, memberId: string, conditionId: string, changes: ConditionChanges): Promise<MedicalCondition>;
  delete(trx: Trx, familyId: string, memberId: string, conditionId: string): Promise<void>;
}

/**
 * Subconjunto de `families` que `health-records` consome pela raiz (modules.md §3 nota 9):
 * `blood_type` vive em `family_members`, não numa tabela de `health-records`.
 */
export interface FamiliesPort<Trx> {
  getBloodType(trx: Trx, familyId: string, memberId: string): Promise<BloodType | null>;
  setBloodType(trx: Trx, familyId: string, memberId: string, bloodType: BloodType): Promise<BloodType>;
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

export interface HealthRecordsDeps<Trx> {
  allergiesRepo: AllergiesRepository<Trx>;
  conditionsRepo: MedicalConditionsRepository<Trx>;
  familiesPort: FamiliesPort<Trx>;
  policy: AccessPolicyPort<Trx>;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}
