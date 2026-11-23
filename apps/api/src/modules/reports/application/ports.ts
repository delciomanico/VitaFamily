// Portas de `reports` (conventions.md §3.2): cada fonte é uma leitura pública do módulo dono,
// ligada no composition root (`main/api.ts`). Já passam pela `AccessPolicy` e pela auditoria do
// módulo dono; sem permissão lançam `ForbiddenError`/`NotFoundError` (secção omitida, BR-RPT-01).
import type { Clock } from "../../../platform/clock/index.js";
import type { MemberPageRead, MemberRead, ReadActor, ReadContext } from "../../../platform/reads/index.js";

export type { ReadActor as ActorIdentity, ReadContext as RequestContext };

export type ApiObject = Record<string, unknown>;

export interface ReportSources {
  /** Membros ativos da família visíveis ao utilizador (`NotFoundError` se não pertencer). */
  listMembers: (userId: string, familyId: string) => Promise<ApiObject[]>;
  bloodType: MemberRead<string>;
  allergies: MemberRead<ApiObject[]>;
  conditions: MemberRead<ApiObject[]>;
  prescriptions: MemberPageRead;
  plans: MemberPageRead;
  doses: MemberPageRead;
  adherence: (actor: ReadActor, familyId: string, memberId: string, query: Record<string, string>, context: ReadContext) => Promise<ApiObject[]>;
  appointments: MemberPageRead;
  examinations: MemberPageRead;
}

export interface ReportsDeps {
  sources: ReportSources;
  clock: Clock;
}

export interface AlertsSummary {
  total: number;
  unread: number;
  byType: Record<string, number>;
}

/**
 * Portas extra do Resumo de saúde (M17), ligadas em `main/api.ts`: `alerts` (contagens dos alertas
 * do próprio pedinte para o membro), `canWrite` (`AccessPolicy`, só para `sourceIds`, BR-RPT-17),
 * `timezone` (fuso efetivo do membro, ADR-010) e `auditView` (`REPORT_VIEW`, sem dados de saúde).
 */
export interface HealthSummarySources {
  alerts: (actor: ReadActor, familyId: string, memberId: string, query: { from: string; to: string }, context: ReadContext) => Promise<AlertsSummary>;
  canWrite: (actor: ReadActor, familyId: string, memberId: string, category: "MEDICATION" | "APPOINTMENTS" | "EXAMS", action: "UPDATE" | "CONFIRM_DOSE") => Promise<boolean>;
  timezone: (familyId: string, memberId: string) => Promise<string>;
  auditView: (actor: ReadActor, familyId: string, memberId: string, kind: "HEALTH_SUMMARY", context: ReadContext) => Promise<void>;
}

/** Limitador de pedidos (ADR-038): subconjunto da porta `RateLimiter` de `platform/rate-limit`. */
export interface SummaryRateLimiter {
  consume: (key: { rule: string; subject: string }, rule: { max: number; windowMs: number }) => Promise<{ allowed: boolean; retryAfterMs: number }>;
}

export interface HealthSummaryDeps extends ReportsDeps {
  summary: HealthSummarySources;
  rateLimiter: SummaryRateLimiter;
}
