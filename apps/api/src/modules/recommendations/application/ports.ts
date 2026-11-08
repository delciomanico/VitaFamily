// Portas do módulo `recommendations` (conventions.md §3.2): definidas aqui, implementadas em
// `infrastructure` (Kysely/pg) ou ligadas à raiz a partir das APIs públicas de `access`,
// `appointments`, `examinations` e `alerts` (modules.md §2). Genéricas em `Trx` para que esta
// camada nunca importe "kysely" (conventions.md §3.9).
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Recommendation } from "../domain/recommendation.js";

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/** Ator do portal da clínica (ADR-020): só os campos de que `application` precisa. */
export interface ClinicPortalActor {
  clinicAccountId: string;
  clinicId: string;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export interface AccessPolicyPort<Trx> {
  can(trx: Trx, input: CanInput): Promise<AccessContext>;
}

export interface MemberNamesPort<Trx> {
  getMemberName(trx: Trx, familyId: string, memberId: string): Promise<string | null>;
}

/** "Esta origem pertence à clínica X e está no estado Y" (modules.md §3 nota 22) — nunca o registo completo. */
export interface OriginFacts {
  familyId: string;
  memberId: string;
  status: string;
  clinicName?: string;
}

export interface OriginsPort<Trx> {
  findAppointmentOfClinic(trx: Trx, clinicId: string, appointmentId: string): Promise<OriginFacts | null>;
  findExaminationOfClinic(trx: Trx, clinicId: string, examinationId: string): Promise<OriginFacts | null>;
}

/** Subconjunto da API pública de `alerts` (`recommendation.added`), ligado só no composition root. */
export interface RecommendationAlertsPort<Trx> {
  raiseRecommendationAdded(trx: Trx, input: { recommendationId: string; familyId: string; memberId: string }): Promise<number>;
}

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface NewRecommendationRecord {
  id: string;
  familyId: string;
  memberId: string;
  clinicId: string;
  clinicName: string;
  clinicAccountId: string;
  appointmentId?: string;
  examinationId?: string;
  text: string;
  createdAt: Date;
}

export interface OriginFilter {
  appointmentId?: string;
  examinationId?: string;
}

export interface MemberRecommendationFilter extends OriginFilter {
  /** Categorias de origem que o ator pode ler (authorization.md §3): a lista omite as restantes. */
  categories: ("APPOINTMENTS" | "EXAMS")[];
}

/** `recommendations` (schema.md §3) — propriedade exclusiva deste módulo. Sem update/delete (imutável, BR-CLN-09). */
export interface RecommendationsRepository<Trx> {
  insert(trx: Trx, record: NewRecommendationRecord): Promise<Recommendation>;
  /** UC-REC-02: só as da própria clínica (`clinic_id`), mais recentes primeiro. */
  listByClinic(trx: Trx, clinicId: string, filter: OriginFilter, limit: number): Promise<Recommendation[]>;
  /** M14 P (ficha do paciente da clínica): só as da própria clínica a este membro, mais recentes primeiro. */
  listByClinicAndMember(trx: Trx, clinicId: string, familyId: string, memberId: string, limit: number): Promise<Recommendation[]>;
  /** UC-REC-03: exige `familyId` (conventions.md §3.4); mais recentes primeiro. */
  listByMember(trx: Trx, familyId: string, memberId: string, filter: MemberRecommendationFilter, limit: number, cursor?: string): Promise<CursorPage<Recommendation>>;
}

export interface RecommendationsDeps<Trx> {
  recommendationsRepo: RecommendationsRepository<Trx>;
  policy: AccessPolicyPort<Trx>;
  memberNames: MemberNamesPort<Trx>;
  origins: OriginsPort<Trx>;
  alerts: RecommendationAlertsPort<Trx>;
  audit: AuditPort<Trx>;
  withTransaction: WithTransaction<Trx>;
  clock: Clock;
}

export type { Recommendation } from "../domain/recommendation.js";
