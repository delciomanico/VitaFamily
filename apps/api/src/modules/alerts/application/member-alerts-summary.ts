// M17 (BR-RPT-15): contagens (total, não lidos, por tipo) dos alertas do PRÓPRIO pedinte para um
// membro, no período local do membro (ADR-010). Só números: nunca o texto dos alertas.
import { addDaysIso, localMidnightUtc } from "../../../platform/time/index.js";
import type { AlertsApiDeps, MemberAlertsSummary } from "./ports.js";

export function createMemberAlertsSummaryUseCase<Trx>(deps: AlertsApiDeps<Trx>) {
  return async function memberAlertsSummary(recipientUserId: string, familyId: string, memberId: string, period: { from: string; to: string }): Promise<MemberAlertsSummary> {
    return deps.withTransaction(async (trx) => {
      const timeZone = await deps.families.getEffectiveTimezone(trx, familyId, memberId);
      const from = localMidnightUtc(period.from, timeZone);
      const to = localMidnightUtc(addDaysIso(period.to, 1), timeZone);
      return deps.alertsRepo.summarizeForMember(trx, recipientUserId, familyId, memberId, from, to);
    });
  };
}
