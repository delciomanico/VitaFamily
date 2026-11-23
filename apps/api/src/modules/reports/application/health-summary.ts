// UC-RPT-05 (Resumo de saúde de um membro) e UC-RPT-05b (da família). Calculado a pedido, nada é
// guardado (BR-RPT-11); sem IA nem interpretação clínica; 30 pedidos/min por utilizador (BR-RPT-18).
import { NotFoundError, RateLimitedError } from "../../../platform/errors/index.js";
import { CLINIC_TIMEZONE, localDateIso } from "../../../platform/time/index.js";
import { resolvePeriod, type ReportPeriod } from "../domain/period.js";
import {
  appointmentsSection,
  examsSection,
  hasAnyFact,
  medicationSection,
  missingSection,
  prescriptionsSection,
  readMemberFacts,
  type MemberFacts,
  type SummaryClock,
} from "./health-summary-core.js";
import type { ActorIdentity, ApiObject, HealthSummaryDeps, RequestContext } from "./ports.js";
import { str } from "./support.js";

export interface HealthSummaryQuery {
  from?: string;
  to?: string;
}

const RATE = { max: 30, windowMs: 60_000 };

async function limit(deps: HealthSummaryDeps, userId: string): Promise<void> {
  const decision = await deps.rateLimiter.consume({ rule: "health-summary", subject: userId }, RATE);
  if (!decision.allowed) throw new RateLimitedError(decision.retryAfterMs, { detail: "Demasiados pedidos; tente mais tarde." });
}

const clockFor = (now: Date, timeZone: string): SummaryClock => ({ now, today: localDateIso(now, timeZone), timeZone });

export function createMemberHealthSummaryUseCase(deps: HealthSummaryDeps) {
  const { sources, summary, clock } = deps;

  return async function memberHealthSummary(actor: ActorIdentity, familyId: string, memberId: string, query: HealthSummaryQuery, context: RequestContext) {
    await limit(deps, actor.userId);
    const now = clock.now();
    const members = await sources.listMembers(actor.userId, familyId);
    const member = members.find((m) => m.id === memberId);
    if (!member) throw new NotFoundError();

    const timeZone = await summary.timezone(familyId, memberId);
    const time = clockFor(now, timeZone);
    const period = resolvePeriod(query.from, query.to, time.today);
    const facts = await readMemberFacts(sources, actor, familyId, memberId, period, time, context);
    // Sem nenhuma secção legível: não revelar sequer que o membro existe (BR-RPT-01).
    if (!hasAnyFact(facts)) throw new NotFoundError();

    const alerts = await summary.alerts(actor, familyId, memberId, period, context);
    const missing = await missingSection(facts, actor, familyId, memberId, time, summary.canWrite);
    const medication = medicationSection(facts, period, time);
    const prescriptions = prescriptionsSection(facts, period, time);
    const exams = examsSection(facts, period, time);
    const appointments = appointmentsSection(facts, period, time);

    // Ver outro titular audita `REPORT_VIEW` (`kind=HEALTH_SUMMARY`), sem dados de saúde.
    if (member.isSelf !== true) await summary.auditView(actor, familyId, memberId, "HEALTH_SUMMARY", context);

    return {
      memberId,
      period,
      generatedAt: now.toISOString(),
      ...(medication ? { medication } : {}),
      ...(prescriptions ? { prescriptions } : {}),
      ...(exams ? { exams } : {}),
      ...(appointments ? { appointments } : {}),
      alerts,
      ...(missing ? { missing } : {}),
    };
  };
}

function familyBlock(member: ApiObject, facts: MemberFacts, period: ReportPeriod, time: SummaryClock, missingCount: number) {
  const medication = medicationSection(facts, period, time);
  const appointments = appointmentsSection(facts, period, time);
  const exams = examsSection(facts, period, time);
  const inPeriod = (date: string) => date !== "" && date >= period.from && date <= period.to;
  const day = (instant: string) => (Number.isNaN(new Date(instant).getTime()) ? "" : localDateIso(new Date(instant), time.timeZone));
  const dates: string[] = [];
  const activity: Record<string, number> = {};

  // Os contratos de leitura não trazem `createdAt`/`updatedAt`: usam-se as datas do próprio registo (a validar).
  if (facts.prescriptions) {
    const issued = facts.prescriptions.map((rx) => str(rx, "issuedOn")).filter(inPeriod);
    activity.prescriptions = issued.length;
    dates.push(...issued);
  }
  if (facts.appointments) {
    const days = facts.appointments.map((a) => day(str(a, "scheduledAt"))).filter((d) => inPeriod(d) && d <= time.today);
    activity.appointments = days.length;
    dates.push(...days);
  }
  if (facts.examinations) {
    const days = facts.examinations.map((e) => str(e, "examDate")).filter((d) => inPeriod(d) && d <= time.today);
    activity.exams = days.length;
    dates.push(...days);
  }
  if (facts.doses) {
    const taken = facts.doses.filter((d) => d.status === "TAKEN");
    activity.dosesConfirmed = taken.length;
    dates.push(...taken.map((d) => day(str(d, "actedAt") || str(d, "scheduledAt"))).filter(inPeriod));
  }

  return {
    memberId: str(member, "id"),
    displayName: str(member, "name"),
    ...(medication ? { adherencePct: medication.overall.adherencePct } : {}),
    ...(facts.activePlans ? { activeMedications: facts.activePlans.length } : {}),
    ...(appointments || exams ? { upcoming30d: (appointments?.upcoming30d ?? 0) + (exams?.upcoming30d ?? 0) } : {}),
    missingCount,
    activity: { ...activity, lastActivityOn: dates.length > 0 ? dates.reduce((a, b) => (a > b ? a : b)) : null },
  };
}

export function createFamilyHealthSummaryUseCase(deps: HealthSummaryDeps) {
  const { sources, summary, clock } = deps;

  return async function familyHealthSummary(actor: ActorIdentity, familyId: string, query: HealthSummaryQuery, context: RequestContext) {
    await limit(deps, actor.userId);
    const now = clock.now();
    const members = await sources.listMembers(actor.userId, familyId);
    const own = members.find((m) => m.isSelf === true);
    const ownZone = own ? await summary.timezone(familyId, str(own, "id")) : CLINIC_TIMEZONE;
    const period = resolvePeriod(query.from, query.to, localDateIso(now, ownZone));

    // Um perfil bloqueado (BR-MEM-11, `MEMBER_BLOCKED`) é negado a todos: não entra na vista (e não a pode derrubar para os restantes membros).
    const blocks = await Promise.all(
      members.filter((member) => member.status !== "BLOCKED").map(async (member) => {
        const memberId = str(member, "id");
        const time = clockFor(now, await summary.timezone(familyId, memberId));
        const facts = await readMemberFacts(sources, actor, familyId, memberId, period, time, context);
        if (!hasAnyFact(facts)) return null;
        // Só contagens: sem `canWrite` não há `sourceIds` (BR-RPT-17).
        const missing = (await missingSection(facts, actor, familyId, memberId, time, null)) ?? [];
        if (member.isSelf !== true) await summary.auditView(actor, familyId, memberId, "HEALTH_SUMMARY", context);
        return familyBlock(member, facts, period, time, missing.reduce((sum, item) => sum + item.count, 0));
      }),
    );
    return { period, generatedAt: now.toISOString(), members: blocks.filter((block) => block !== null) };
  };
}
