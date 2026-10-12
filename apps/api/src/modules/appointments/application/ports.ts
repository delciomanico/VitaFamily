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

/**
 * Ator do portal da clínica (ADR-020, `platform/actor.ClinicActorInfo`) — só os campos que
 * `appointments/application` precisa, sem importar `platform/actor` aqui (essa leitura é da
 * `interface`, conventions.md §3.9). Mesmo critério de `clinics/application/ports.ts#ClinicPortalActor`
 * (duplicado deliberadamente: nenhuma aresta nova no grafo de módulos).
 */
export interface ClinicPortalActor {
  clinicAccountId: string;
  clinicId: string;
}

/** Subconjunto de `AccessPolicy<Trx>` que `appointments` chama pela raiz (`access.policy`, modules.md §2). */
export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

/**
 * Subconjunto de `access.getMembershipFacts` (modules.md §3 nota 11 — já usado por `clinics`,
 * mesma função pública): pertença estrutural do ator à família, para `listAvailableSlots`
 * (endpoints.md: `AUTHORIZATION: FAM_MEMBER`, sem categoria de dados de saúde — por isso não passa
 * por `policy.can()`).
 */
export interface MembershipPort<Trx> {
  getMembershipFacts(trx: Trx, familyId: string, userId: string): Promise<{ memberId: string; status: "ACTIVE" | "BLOCKED" } | null>;
}

/**
 * `access.getMemberName` (modules.md §2, Fase D — ver nota em `access/index.ts`): nome do membro
 * para `ClinicBooking.patientName` (BR-CLN-03) — mínimo necessário, nunca mais do que isto chega
 * ao portal da clínica. Sem `trx` próprio: usa sempre a transação do caso de uso.
 */
export interface MemberNamesPort<Trx> {
  getMemberName(trx: Trx, familyId: string, memberId: string): Promise<string | null>;
}

/** Horário de clínica parceira (`ClinicSlot`, API pública de `clinics`) — só os campos que
 * `appointments` precisa para reservar/mostrar um pedido (BR-APT-04/06). */
export interface ClinicSlotLite {
  id: string;
  clinicId: string;
  specialty: string;
  professionalName?: string;
  startsAt: Date;
  durationMinutes: number;
}

/** Subconjunto da API pública de `clinics` (modules.md §2: `ClinicLookup`) — resolve o nome
 * atual de uma clínica selecionável (BR-APT-04/BR-CLN-02: o nome fica congelado na consulta) e,
 * desde a Fase D (D17), os horários publicados (`clinics.listFreeClinicSlots`/`findClinicSlot`,
 * já expostos pela raiz de `clinics` — sem transação própria, mesmo critério das duas funções
 * originais: leitura best-effort fora da transação de escrita de `appointments`, com o índice
 * único de `clinic_slots`/`appointments.slot_id` como rede de segurança final contra corrida). */
export interface ClinicsPort<Trx> {
  getBookableClinic(trx: Trx, familyId: string, clinicId: string): Promise<{ id: string; name: string } | null>;
  listFreeSlots(clinicId: string, specialty?: string): Promise<ClinicSlotLite[]>;
  findSlot(clinicId: string, slotId: string): Promise<ClinicSlotLite | null>;
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
  specialty?: string;
  reason?: string;
  notes?: string;
  /** Horário de clínica parceira de origem (D17) — só em consultas que nasceram `REQUESTED`. */
  slotId?: string;
  createdAt: Date;
}

export interface AppointmentChanges {
  scheduledAt?: Date;
  professionalName?: string | null;
  clinicId?: string | null;
  clinicName?: string | null;
  specialty?: string | null;
  reason?: string | null;
  notes?: string | null;
}

/** Transição de estado feita pela clínica (D17: confirmar/recusar/cancelar) — grava sempre o
 * motivo (`responseNote`), mesmo que vazio/omitido. */
export interface ClinicStatusChange {
  status: AppointmentStatus;
  responseNote?: string | null;
}

/** `completeConsultation` (D18, BR-CLN-06): sempre `COMPLETED`, com o resultado e quem o registou. */
export interface ClinicOutcomeChange {
  outcomeNote?: string | null;
  clinicAccountId: string;
  recordedAt: Date;
}

/**
 * Medicamento de uma receita emitida pela clínica (D18, BR-RX-07) — duplicado deliberadamente de
 * `medications.CreateMedicationPlanInput` (mesmo critério de `ClinicPortalActor`, linha 19 acima):
 * `appointments` não depende de `medications`/`prescriptions` (modules.md §2); esta forma só
 * precisa de atravessar a porta `PrescriptionsPort` abaixo, ligada no composition root.
 */
export interface ClinicPrescriptionMedicationInput {
  name: string;
  dosage: string;
  scheduleType: "FIXED_TIMES" | "INTERVAL";
  times?: string[] | null;
  daysOfWeek?: number[] | null;
  intervalHours?: number | null;
  startAt: string;
  endAt?: string | null;
  continuous?: boolean | null;
  notes?: string | null;
}

/** `PrescriptionInput` (openapi.yaml) emitida pela clínica, no mesmo pedido de `completeConsultation`. */
export interface ClinicPrescriptionInput {
  issuedOn: string;
  doctorName?: string | null;
  notes?: string | null;
  medications: ClinicPrescriptionMedicationInput[];
}

/**
 * Porta para `prescriptions.issuePrescriptionForClinic` (D18, BR-CLN-06/BR-RX-07): `appointments`
 * e `prescriptions` não têm aresta declarada entre si (modules.md §2) — esta porta é definida aqui
 * e ligada no composition root (`main/api.ts`) à função pública de `prescriptions`, mesmo critério
 * de `reports`/`lifecycle` (modules.md §3 notas 16/20: porta na `application`, "nenhuma aresta nova
 * no grafo"). Recebe `trx` já aberto — a mesma transação de `completeConsultation`.
 */
export interface PrescriptionsPort<Trx> {
  issueForClinic(
    trx: Trx,
    familyId: string,
    memberId: string,
    input: ClinicPrescriptionInput,
    origin: { clinicAccountId: string; appointmentId: string },
    context: RequestContext,
  ): Promise<{ id: string }>;
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
  /** `alerts.scan` (M8, modules.md §3 nota 3): candidatas a `appointment.24h`/`appointment.2h`
   * (`SCHEDULED`, ainda no futuro — `alerts` decide por regra pura se o instante já foi atingido)
   * ou a `appointment.outcome` (`SCHEDULED`, já passada há `outcomeWindowMs`, sem pedido ainda —
   * BR-APT-02/Q4). `alerts` nunca acede a `appointments` diretamente (conventions.md §3.5). */
  listReminderCandidates(trx: Trx, now: Date, outcomeWindowMs: number, limit: number): Promise<Appointment[]>;
  /** `alerts.scan` (M8): regista que o pedido de confirmação do desfecho já foi enviado para esta
   * consulta — único escritor de `outcome_requested_at` (`appointments/README.md`). */
  setOutcomeRequested(trx: Trx, appointmentId: string, requestedAt: Date): Promise<void>;
  /** BR-APT-06 (D17): a marcação ativa (REQUESTED/SCHEDULED) de um horário, se existir — pré-cheque
   * antes do `insert` (a UNIQUE parcial `appointments_slot_active_booking_idx` é a rede de
   * segurança final contra corrida, schema.md §4). */
  findActiveBySlot(trx: Trx, slotId: string): Promise<Appointment | null>;
  /** `listAvailableSlots` (D17, endpoints.md): de entre os horários publicados devolvidos por
   * `clinics.listFreeSlots`, quais já têm marcação ativa (REQUESTED/SCHEDULED) — BR-APT-06. */
  listActiveSlotIds(trx: Trx, slotIds: string[]): Promise<string[]>;
  /** Portal da clínica (D17, authorization.md §6.1 passo 2): só devolve a consulta se for da
   * própria clínica (`clinicId` do ator) — nunca a de outra (quem chama decide `NOT_FOUND`, mesmo
   * critério de não enumerar recursos de outra família). */
  findByClinicId(trx: Trx, clinicId: string, appointmentId: string): Promise<Appointment | null>;
  /** `listClinicRequests`/`listClinicAgenda` (D17, UC-CLN-05/06): consultas da própria clínica por
   * estado, por ordem cronológica. */
  listByClinicAndStatus(trx: Trx, clinicId: string, statuses: AppointmentStatus[], filter: { from?: Date; to?: Date }): Promise<Appointment[]>;
  /** `confirmRequest`/`rejectRequest`/`cancelByClinic` (D17): só escritor de `status`+`response_note`
   * para o portal da clínica — nunca `familyId`/`memberId` (o ator de clínica não os conhece). */
  updateStatusByClinic(trx: Trx, appointmentId: string, change: ClinicStatusChange): Promise<Appointment>;
  /** `completeConsultation` (D18, BR-CLN-06): marca `COMPLETED` e grava o resultado da consulta,
   * sempre com quem o registou — nunca escrito pela família. */
  completeByClinic(trx: Trx, appointmentId: string, change: ClinicOutcomeChange): Promise<Appointment>;
}

export interface AppointmentsDeps<Trx> {
  appointmentsRepo: AppointmentsRepository<Trx>;
  policy: AccessPolicyPort<Trx>;
  membership: MembershipPort<Trx>;
  memberNames: MemberNamesPort<Trx>;
  clinics: ClinicsPort<Trx>;
  /** D18 (BR-CLN-06/BR-RX-07) — ver `PrescriptionsPort` acima. */
  prescriptions: PrescriptionsPort<Trx>;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

export type { Appointment, AppointmentStatus } from "../domain/appointment.js";
