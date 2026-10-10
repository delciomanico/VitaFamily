// Portas do módulo `appointments` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir da API pública de `access`/`clinics`
// (modules.md §2: `appointments` depende de `access`, `clinics`, `audit`). Genéricas em `Trx`
// para que esta camada nunca importe "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Appointment, AppointmentStatus } from "../domain/appointment.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/** Subconjunto de `AccessPolicy<Trx>` que `appointments` chama pela raiz (`access.policy`, modules.md §2). */
export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

/** Subconjunto da API pública de `clinics` (modules.md §2: `ClinicLookup`) — resolve o nome
 * atual de uma clínica selecionável (BR-APT-04/BR-CLN-02: o nome fica congelado na consulta). */
export interface ClinicsPort<Trx> {
  getBookableClinic(trx: Trx, familyId: string, clinicId: string): Promise<{ id: string; name: string } | null>;
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

export interface NewAppointmentRecord {
  id: string;
  familyId: string;
  memberId: string;
  scheduledAt: Date;
  status: AppointmentStatus;
  professionalName?: string;
  clinicId?: string;
  clinicName?: string;
  reason?: string;
  notes?: string;
  createdAt: Date;
}

export interface AppointmentChanges {
  scheduledAt?: Date;
  professionalName?: string | null;
  clinicId?: string | null;
  clinicName?: string | null;
  reason?: string | null;
  notes?: string | null;
}

export interface AppointmentListFilter {
  status?: AppointmentStatus;
  from?: Date;
  to?: Date;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/** `appointments` (schema.md §3) — propriedade exclusiva deste módulo (conventions.md §3.5). */
export interface AppointmentsRepository<Trx> {
  insert(trx: Trx, record: NewAppointmentRecord): Promise<Appointment>;
  findById(trx: Trx, familyId: string, memberId: string, appointmentId: string): Promise<Appointment | null>;
  listByMember(trx: Trx, familyId: string, memberId: string, filter: AppointmentListFilter, limit: number, cursor?: string): Promise<CursorPage<Appointment>>;
  update(trx: Trx, familyId: string, memberId: string, appointmentId: string, changes: AppointmentChanges): Promise<Appointment>;
  updateStatus(trx: Trx, familyId: string, memberId: string, appointmentId: string, status: AppointmentStatus): Promise<Appointment>;
  delete(trx: Trx, familyId: string, memberId: string, appointmentId: string): Promise<void>;
}

export interface AppointmentsDeps<Trx> {
  appointmentsRepo: AppointmentsRepository<Trx>;
  policy: AccessPolicyPort<Trx>;
  clinics: ClinicsPort<Trx>;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

export type { Appointment, AppointmentStatus } from "../domain/appointment.js";
