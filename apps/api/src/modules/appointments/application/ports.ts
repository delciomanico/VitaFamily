// Portas do módulo `appointments` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir da API pública de `access`/`clinics`
// (modules.md §2: `appointments` depende de `access`, `clinics`, `audit`). Genéricas em `Trx`
// para que esta camada nunca importe "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Appointment, AppointmentStatus, ConfirmationSource, ConfirmationStatus } from "../domain/appointment.js";
import type { WalkInRateLimiter } from "../domain/walk-in.js";

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
  /** BR-APT-10 (D19): uma consulta só se marca em `APPOINTMENT`; em `EXAM`, `specialty` é o tipo de exame. */
  kind: "APPOINTMENT" | "EXAM";
  specialty: string;
  professionalName?: string;
  startsAt: Date;
  durationMinutes: number;
  /** BR-APT-11: vagas do horário (1 em `APPOINTMENT`). */
  capacity: number;
  /** M14 (BR-CLN-13): profissional do catálogo; nulo/ausente nos horários manuais antigos. */
  professionalId?: string;
}

/** `AvailableSlot` (openapi): horário + vagas restantes (`remaining` ≥ 1 nas listagens, BR-APT-11). */
export interface AvailableSlotItem extends ClinicSlotLite {
  remaining: number;
}

/** Subconjunto da API pública de `clinics` (modules.md §2: `ClinicLookup`) — resolve o nome
 * atual de uma clínica selecionável (BR-APT-04/BR-CLN-02: o nome fica congelado na consulta) e,
 * desde a Fase D (D17), os horários publicados (`clinics.listFreeClinicSlots`/`findClinicSlot`,
 * já expostos pela raiz de `clinics` — sem transação própria, mesmo critério das duas funções
 * originais: leitura best-effort fora da transação de escrita de `appointments`, com o índice
 * único de `clinic_slots`/`appointments.slot_id` como rede de segurança final contra corrida). */
export interface ClinicsPort<Trx> {
  getBookableClinic(trx: Trx, familyId: string, clinicId: string): Promise<{ id: string; name: string } | null>;
  listFreeSlots(clinicId: string, specialty?: string, kind?: "APPOINTMENT" | "EXAM"): Promise<ClinicSlotLite[]>;
  findSlot(clinicId: string, slotId: string): Promise<ClinicSlotLite | null>;
  /** BR-APT-11/BR-CLN-10: bloqueia a linha do horário (`FOR UPDATE`) na transação do chamador — serializa reservas concorrentes. */
  lockSlot(trx: Trx, slotId: string): Promise<ClinicSlotLite | null>;
  /** BR-CLN-13: ids dos outros horários do profissional que se sobrepõem a `[from, to)` (defesa em profundidade no walk-in). */
  listProfessionalSlotsOverlapping(trx: Trx, professionalId: string, from: Date, to: Date, excludeSlotId: string): Promise<string[]>;
}

/**
 * BR-APT-10/11: a ocupação de um horário `EXAM` é o número de `Examination` `SCHEDULED` com esse
 * `slotId` (tabela de `examinations`). `appointments` não depende de `examinations` (modules.md §2):
 * a porta é ligada no composition root à função pública de `examinations`.
 */
export interface ExamSlotOccupancyPort<Trx> {
  countScheduledBySlot(trx: Trx, slotIds: string[]): Promise<{ slotId: string; count: number }[]>;
}

/** Marcações ativas de consulta de um horário (para a ocupação do portal da clínica, `clinics`). */
export interface AppointmentSlotBookingCount {
  slotId: string;
  requested: number;
  scheduled: number;
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
  /** Horário de clínica parceira de origem (D17) — `REQUESTED` ou walk-in (D20). */
  slotId?: string;
  /** D20 (ADR-024): marcação presencial pela clínica. */
  walkIn?: boolean;
  bookedByClinicAccountId?: string;
  /** BR-CLN-16: copiada do horário ao reservar; omitido = 30 (default da BD). */
  durationMinutes?: number;
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

/** BR-CLN-26: resposta do paciente; `cancel` = "Não posso" (`SCHEDULED -> CANCELLED` na mesma escrita). */
export interface ConfirmationChange {
  confirmationStatus: ConfirmationStatus;
  confirmationSource: ConfirmationSource | null;
  confirmedAt: Date | null;
  cancel?: boolean;
}

/** BR-CLN-28: chegada/início/falta; só os campos presentes mudam. */
export interface DayFlowChange {
  status?: AppointmentStatus;
  arrivedAt?: Date;
  startedAt?: Date;
}

/** Janelas do scanner (`alerts`): limite futuro dos lembretes e limiar passado do pedido de desfecho. */
export interface ReminderWindows {
  lookaheadMs: number;
  outcomeWindowMs: number;
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

export interface ClinicAppointmentsFilter {
  from?: Date;
  /** Exclusivo. */
  to?: Date;
  familyId?: string;
  memberId?: string;
}

/** `appointments` (schema.md §3) — propriedade exclusiva deste módulo (conventions.md §3.5). */
export interface AppointmentsRepository<Trx> {
  insert(trx: Trx, record: NewAppointmentRecord): Promise<Appointment>;
  findById(trx: Trx, familyId: string, memberId: string, appointmentId: string): Promise<Appointment | null>;
  listByMember(trx: Trx, familyId: string, memberId: string, filter: AppointmentListFilter, limit: number, cursor?: string): Promise<CursorPage<Appointment>>;
  update(trx: Trx, familyId: string, memberId: string, appointmentId: string, changes: AppointmentChanges): Promise<Appointment>;
  /** `resetDayFlow` (BR-CLN-25): reativação `CANCELLED -> SCHEDULED` repõe `PENDING` e anula confirmação/chegada/início. Sair de `COMPLETED` limpa o retorno (BR-CLN-30). */
  updateStatus(trx: Trx, familyId: string, memberId: string, appointmentId: string, status: AppointmentStatus, options?: { resetDayFlow?: boolean }): Promise<Appointment>;
  delete(trx: Trx, familyId: string, memberId: string, appointmentId: string): Promise<void>;
  /** `alerts.scan` (M8, modules.md §3 nota 3): candidatas a `appointment.24h`/`appointment.2h`
   * (`SCHEDULED`, ainda no futuro — `alerts` decide por regra pura se o instante já foi atingido)
   * ou a `appointment.outcome` (`SCHEDULED`, já passada há `outcomeWindowMs`, sem pedido ainda —
   * BR-APT-02/Q4). `alerts` nunca acede a `appointments` diretamente (conventions.md §3.5). */
  listReminderCandidates(trx: Trx, now: Date, windows: ReminderWindows, limit: number): Promise<Appointment[]>;
  /** `alerts.scan` (BR-CLN-30): consultas `COMPLETED` com retorno em `[from, to]` (AAAA-MM-DD). */
  listFollowUpCandidates(trx: Trx, from: string, to: string, limit: number): Promise<Appointment[]>;
  /** M14 Q (BR-CLN-26): resposta do paciente (`familyId`+`memberId` obrigatórios, conventions §3.4). */
  applyConfirmation(trx: Trx, familyId: string, memberId: string, appointmentId: string, change: ConfirmationChange): Promise<Appointment>;
  /** M14 Q (BR-CLN-27): "confirmado por telefone" (`CLINIC`). */
  applyConfirmationByClinic(trx: Trx, clinicId: string, appointmentId: string, confirmedAt: Date): Promise<Appointment>;
  /** M14 Q (BR-CLN-28): chegada/início/falta. */
  applyDayFlow(trx: Trx, clinicId: string, appointmentId: string, change: DayFlowChange): Promise<Appointment>;
  /** M14 Q (BR-CLN-30): define (AAAA-MM-DD) ou limpa (`null`) o retorno. */
  setFollowUp(trx: Trx, clinicId: string, appointmentId: string, dueOn: string | null): Promise<Appointment>;
  /** M14 Q (BR-CLN-30): consultas `COMPLETED` da clínica com retorno até `until` (AAAA-MM-DD), por data. */
  listFollowUpsByClinic(trx: Trx, clinicId: string, until: string, limit: number): Promise<Appointment[]>;
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
  /** BR-APT-11 (`clinics`, `ClinicSlotView`): consultas `REQUESTED`/`SCHEDULED` por horário. */
  countActiveBySlot(trx: Trx, slotIds: string[]): Promise<AppointmentSlotBookingCount[]>;
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
  /** M14 P (`clinic-patients`, leitura): consultas da clínica por `scheduled_at` (`[from, to)`), opcionalmente de um membro;
   * com `limit` devolve as mais recentes primeiro. */
  listForClinic(trx: Trx, clinicId: string, filter: ClinicAppointmentsFilter, limit?: number): Promise<Appointment[]>;
  /** BR-CLN-10/16 (walk-in): consultas `SCHEDULED` do membro cujo intervalo `[início, início + duração)` sobrepõe `[from, to)`. */
  findScheduledOverlapping(trx: Trx, familyId: string, memberId: string, from: Date, to: Date): Promise<Appointment[]>;
}

/**
 * D20 (ADR-024, BR-CLN-10): resolução do paciente a partir do e-mail exato — ligada no composition
 * root a `users.byEmail` + `families` (nenhuma aresta nova no grafo; mesmo critério de
 * `PrescriptionsPort`). Devolve `null` para e-mail inexistente, utilizador não `ACTIVE` ou sem
 * membro `SELF` (o oráculo é uniforme). O e-mail recebido já vem normalizado; nunca é registado.
 */
export interface PatientDirectoryPort<Trx> {
  findSelfByEmail(trx: Trx, email: string): Promise<{ familyId: string; memberId: string; fullName: string } | null>;
}

/**
 * `ClinicPatientDirectory` (M14 P, BR-CLN-18, modules.md §2): o que o walk-in e a agenda pedem ao módulo
 * `clinic-patients` — definida aqui e implementada lá (ligada no composition root; `appointments` nunca importa
 * `clinic-patients` nem lê as suas tabelas). Todas as operações correm na transação do chamador.
 */
export interface ClinicVisitBookingView {
  id: string;
  status: "SCHEDULED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  scheduledAt: string;
  specialty?: string;
  professionalName?: string;
  patientName: string;
  notes?: string;
  responseNote?: string;
  source: "MANUAL";
  clinicPatientId: string;
  slotId?: string;
  /** M14 Q (BR-CLN-25/28/30). */
  confirmationStatus: ConfirmationStatus;
  confirmationSource?: ConfirmationSource;
  dayState: "SCHEDULED" | "ARRIVED" | "IN_PROGRESS" | "COMPLETED" | "NO_SHOW" | "CANCELLED";
  arrivedAt?: string;
  startedAt?: string;
  waitingMinutes?: number;
  followUpDueOn?: string;
}

export interface ClinicPatientDirectoryPort<Trx> {
  /** Paciente da clínica; `null` se de outra clínica/inexistente. `link` só no servidor (nunca sai para o portal). */
  resolvePatient(trx: Trx, clinicId: string, clinicPatientId: string): Promise<{ clinicPatientId: string; name: string; link: { familyId: string; memberId: string } | null } | null>;
  /** BR-CLN-18 (a): cria/reutiliza o paciente ligado ao membro `SELF` (`via=EMAIL`) e garante `BOOKINGS`. */
  ensureLinkedByEmail(trx: Trx, actor: ClinicPortalActor, input: { familyId: string; memberId: string; fullName: string }, context: RequestContext): Promise<{ clinicPatientId: string }>;
  /** BR-CLN-18 (c): visita presencial manual (bloqueia o horário, valida sobreposições, audita `CLINIC_VISIT_BOOK`). */
  bookVisit(trx: Trx, actor: ClinicPortalActor, input: { clinicPatientId: string; slotId: string; notes?: string | null }, context: RequestContext): Promise<ClinicVisitBookingView>;
  listVisits(trx: Trx, clinicId: string, filter: { from?: Date; to?: Date }): Promise<ClinicVisitBookingView[]>;
  /** `null` se o id não é uma visita da clínica (o chamador decide o 404). */
  cancelVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, note: string, context: RequestContext): Promise<ClinicVisitBookingView | null>;
  completeVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, input: { outcomeNote?: string | null; prescription?: unknown }, context: RequestContext): Promise<ClinicVisitBookingView | null>;
  /** M14 Q (BR-CLN-27/28/30): ações do dia e retorno sobre uma visita; `null` se o id não é uma visita da clínica. */
  confirmVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, context: RequestContext): Promise<ClinicVisitBookingView | null>;
  arriveVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, context: RequestContext): Promise<ClinicVisitBookingView | null>;
  startVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, context: RequestContext): Promise<ClinicVisitBookingView | null>;
  noShowVisit(trx: Trx, actor: ClinicPortalActor, visitId: string, context: RequestContext): Promise<ClinicVisitBookingView | null>;
  setVisitFollowUp(trx: Trx, actor: ClinicPortalActor, visitId: string, input: { amount: unknown; unit: unknown }, context: RequestContext): Promise<ClinicVisitBookingView | null>;
  clearVisitFollowUp(trx: Trx, actor: ClinicPortalActor, visitId: string, context: RequestContext): Promise<ClinicVisitBookingView | null>;
  /** BR-APT-06: visitas `SCHEDULED` por horário (ocupam-no). */
  countActiveVisitsBySlot(trx: Trx, slotIds: string[]): Promise<{ slotId: string; count: number }[]>;
  /** `memberId -> clinicPatientId` na clínica (consultas Vita associam-se ao paciente pela ligação). */
  findPatientIdsByMembers(trx: Trx, clinicId: string, memberIds: string[]): Promise<Map<string, string>>;
}

export interface AppointmentsDeps<Trx> {
  appointmentsRepo: AppointmentsRepository<Trx>;
  policy: AccessPolicyPort<Trx>;
  membership: MembershipPort<Trx>;
  memberNames: MemberNamesPort<Trx>;
  clinics: ClinicsPort<Trx>;
  /** D19 (BR-APT-10/11): ocupação de horários `EXAM` (exames `SCHEDULED`) — ver `ExamSlotOccupancyPort`. */
  examSlotOccupancy: ExamSlotOccupancyPort<Trx>;
  /** D18 (BR-CLN-06/BR-RX-07) — ver `PrescriptionsPort` acima. */
  prescriptions: PrescriptionsPort<Trx>;
  /** D20 (ADR-024): pesquisa de paciente por e-mail exato (walk-in). */
  patients: PatientDirectoryPort<Trx>;
  /** M14 P (BR-CLN-18): pacientes da clínica e visitas manuais (implementada por `clinic-patients`). */
  clinicPatients: ClinicPatientDirectoryPort<Trx>;
  /** BR-CLN-10: rate limit dos endpoints walk-in (por conta, por IP, falhas 404). */
  walkInRateLimiter: WalkInRateLimiter;
  audit: AuditPort<Trx>;
  db: Trx;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

export type { Appointment, AppointmentStatus } from "../domain/appointment.js";
