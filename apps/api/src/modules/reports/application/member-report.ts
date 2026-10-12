// UC-RPT-01 Relatório individual (FR-RPT-01, Q11): só as secções que o pedinte pode ver; as que
// não pode são omitidas. A autorização e a auditoria ("geração do relatório de outro titular")
// vêm de cada leitura do módulo dono, que as aplica como nos endpoints GET.
import { NotFoundError } from "../../../platform/errors/index.js";
import { resolvePeriod } from "../domain/period.js";
import type { ActorIdentity, ApiObject, ReportsDeps, RequestContext } from "./ports.js";
import { readAll, readable, str } from "./support.js";

export interface MemberReportQuery {
  from?: string;
  to?: string;
}

export function createMemberReportUseCase(deps: ReportsDeps) {
  const { sources, clock } = deps;

  return async function memberReport(
    actor: ActorIdentity,
    familyId: string,
    memberId: string,
    query: MemberReportQuery,
    context: RequestContext,
  ) {
    const now = clock.now();
    const period = resolvePeriod(query.from, query.to, now.toISOString().slice(0, 10));
    const fromInstant = `${period.from}T00:00:00.000Z`;
    const toInstant = `${period.to}T23:59:59.999Z`;

    const members = await sources.listMembers(actor.userId, familyId);
    const member = members.find((m) => m.id === memberId);
    if (!member) throw new NotFoundError();

    const [bloodType, allergies, conditions, prescriptions, plans, adherence, appointments, examinations] = await Promise.all([
      readable(() => sources.bloodType(actor, familyId, memberId, context)),
      readable(() => sources.allergies(actor, familyId, memberId, context)),
      readable(() => sources.conditions(actor, familyId, memberId, context)),
      readable(() => readAll(sources.prescriptions, actor, familyId, memberId, {}, context)),
      readable(() => readAll(sources.plans, actor, familyId, memberId, {}, context)),
      readable(() => sources.adherence(actor, familyId, memberId, { from: fromInstant, to: toInstant }, context)),
      // Consultas do período e as futuras (UC-RPT-01): sem limite superior.
      readable(() => readAll(sources.appointments, actor, familyId, memberId, { from: fromInstant }, context)),
      readable(() => readAll(sources.examinations, actor, familyId, memberId, {}, context)),
    ]);

    const sections = [bloodType, allergies, conditions, prescriptions, plans, adherence, appointments, examinations];
    // Sem nenhuma secção legível e não sendo o próprio/tutor: não revelar sequer que o membro existe.
    if (sections.every((section) => section === undefined)) throw new NotFoundError();

    const inPeriod = (date: string) => date.slice(0, 10) >= period.from && date.slice(0, 10) <= period.to;
    const byRecent = (key: string) => (a: ApiObject, b: ApiObject) => str(b, key).localeCompare(str(a, key));

    return {
      generatedAt: now.toISOString(),
      from: period.from,
      to: period.to,
      member,
      ...(bloodType !== undefined ? { bloodType } : {}),
      ...(allergies !== undefined ? { allergies } : {}),
      ...(conditions !== undefined ? { conditions } : {}),
      ...(prescriptions !== undefined
        ? { prescriptions: prescriptions.filter((p) => p.status === "ACTIVE" || inPeriod(str(p, "issuedOn"))).sort(byRecent("issuedOn")) }
        : {}),
      ...(plans !== undefined ? { medicationPlans: plans } : {}),
      ...(adherence !== undefined ? { adherence } : {}),
      ...(appointments !== undefined ? { appointments: [...appointments].sort(byRecent("scheduledAt")) } : {}),
      ...(examinations !== undefined
        ? {
            examinations: examinations
              .filter((e) => str(e, "examDate") >= period.from && (str(e, "examDate") <= period.to || e.status === "SCHEDULED"))
              .sort(byRecent("examDate")),
          }
        : {}),
    };
  };
}
