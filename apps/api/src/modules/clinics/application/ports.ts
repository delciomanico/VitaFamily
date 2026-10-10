// Portas do módulo `clinics` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir da API pública de `access`
// (modules.md §2: `clinics` depende só de `access`). Genéricas em `Trx` para que esta camada
// nunca importe "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Clinic, ClinicStatus, ClinicType } from "../domain/clinic.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/**
 * Subconjunto de `AccessModule` que `clinics` consome pela raiz (modules.md §2, nota 11): só
 * `getMembershipFacts` (estrutura, não categoria de dados de saúde — `authorization.md` §4).
 */
export interface MembershipFacts {
  memberId: string;
  role?: "FAMILY_ADMIN" | "FAMILY_MEMBER";
  isAdult: boolean;
  status: "ACTIVE" | "BLOCKED";
}

export interface AccessPort<Trx> {
  getMembershipFacts(trx: Trx, familyId: string, userId: string): Promise<MembershipFacts | null>;
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

export interface NewClinicRecord {
  id: string;
  type: ClinicType;
  familyId?: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  createdBy?: string;
  createdAt: Date;
}

export interface ClinicChanges {
  name?: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ClinicListFilter {
  status?: ClinicStatus;
}

/** `clinics` (schema.md §3) — propriedade exclusiva deste módulo (conventions.md §3.5). */
export interface ClinicsRepository<Trx> {
  insert(trx: Trx, record: NewClinicRecord): Promise<Clinic>;
  /** Procura global por id (clínicas parceiras não têm família); quem chama confirma `type`/`familyId`. */
  findById(trx: Trx, clinicId: string): Promise<Clinic | null>;
  /** Parceiras (todas) + privadas de `familyId` (UC-CLN-02). */
  listVisibleToFamily(trx: Trx, familyId: string, filter: ClinicListFilter): Promise<Clinic[]>;
  /** Só parceiras (UC-ADM-03/admin). */
  listPartners(trx: Trx, filter: ClinicListFilter): Promise<Clinic[]>;
  countPrivateByFamily(trx: Trx, familyId: string): Promise<number>;
  update(trx: Trx, clinicId: string, changes: ClinicChanges): Promise<Clinic>;
  updateStatus(trx: Trx, clinicId: string, status: ClinicStatus): Promise<Clinic>;
  delete(trx: Trx, clinicId: string): Promise<void>;
}

export interface ClinicsDeps<Trx> {
  clinicsRepo: ClinicsRepository<Trx>;
  access: AccessPort<Trx>;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

export type { Clinic, ClinicStatus, ClinicType } from "../domain/clinic.js";
