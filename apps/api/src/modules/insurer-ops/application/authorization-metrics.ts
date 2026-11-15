// openapi getInsurerAuthorizationMetrics (BR-AUT-20): SLA e auto-aprovação MEDIDOS, não decididos. `open` é o retrato de agora;
// `period` agrega os pedidos cuja decisão (`decidedAt`, estado atual APPROVED/REJECTED) caiu em [from, to). Só agregados, sem dados pessoais.
// Aproximação documentada: um pedido reaberto só volta a contar quando decidido de novo.
import { ValidationError } from "../../../platform/errors/index.js";
import type { OpsActor } from "../domain/access.js";
import { isIsoDate } from "../domain/validation.js";
import { percentage } from "../domain/sla.js";
import { addDays } from "../domain/validation.js";
import type { OpsDeps } from "./ports.js";
import { authorize } from "./support.js";

const MAX_RANGE_DAYS = 366;
const DEFAULT_RANGE_DAYS = 30;
const MS_PER_DAY = 86_400_000;

export interface AuthorizationMetricsView {
  open: { total: number; unassigned: number; overdue: number; escalated: number; infoRequested: number };
  period: {
    from: string;
    to: string;
    decided: number;
    approved: number;
    rejected: number;
    autoApproved: number;
    decidedWithinSla: number;
    slaMetPct: number | null;
    autoApprovedPct: number | null;
    medianDecisionHours: number | null;
  };
}

function parseDate(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isIsoDate(value)) throw new ValidationError([{ field, message: "data inválida (AAAA-MM-DD)" }], { detail: "Dados inválidos." });
  return value;
}

export function createGetAuthorizationMetricsUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function getAuthorizationMetrics(actor: OpsActor, query: { from?: unknown; to?: unknown }): Promise<AuthorizationMetricsView> {
    const now = deps.clock.now();
    // `to` exclusivo, por omissão amanhã (UTC); `from` por omissão 30 dias antes de `to`.
    const to = parseDate(query.to, "to") ?? addDays(now.toISOString().slice(0, 10), 1);
    const from = parseDate(query.from, "from") ?? addDays(to, -DEFAULT_RANGE_DAYS);
    const span = (Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / MS_PER_DAY;
    if (span <= 0 || span > MAX_RANGE_DAYS) throw new ValidationError([{ field: "to", message: `intervalo entre 1 e ${String(MAX_RANGE_DAYS)} dias` }], { detail: "Dados inválidos." });
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "authorizations-read");
      const counts = await deps.insurerAuthorizations.metrics(trx, actor.insurerId, { from: new Date(`${from}T00:00:00.000Z`), to: new Date(`${to}T00:00:00.000Z`) }, now);
      const p = counts.period;
      return {
        open: counts.open,
        period: { from, to, ...p, slaMetPct: percentage(p.decidedWithinSla, p.decided), autoApprovedPct: percentage(p.autoApproved, p.decided) },
      };
    });
  };
}
