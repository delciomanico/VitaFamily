// `deriveCoverageView` — função PURA (BR-PRC-12/13/14; state-machines.md "Process" tabela 3/§5; TC-PRC-29): o estado simples do
// pedido à seguradora que a família vê em `Process.coverage`. Sem relógio, I/O nem acesso à BD. Só estado e datas: nunca motivo,
// valor, serviço, decisor, nota, rasto nem a distinção automático/manual.
import type { ActFact, CoverageFact, CoveragePhase } from "./process.js";

export type CoverageViewState = "PENDING" | "NEEDS_INFO" | "APPROVED" | "NOT_APPROVED" | "EXPIRED" | "WITHDRAWN";

export interface CoverageView {
  state: CoverageViewState;
  appeal: boolean;
  partial: boolean;
  dueAt?: Date;
  validUntil?: Date;
}

/** `null` = sem bloco (fecho do pedido sem estado a mostrar). `Record` total: fase nova sem linha não compila. */
const STATE_OF_PHASE: Record<CoveragePhase, CoverageViewState | null> = {
  PENDING_DECISION: "PENDING",
  NEEDS_INFO: "NEEDS_INFO",
  APPROVED: "APPROVED",
  NOT_APPROVED: "NOT_APPROVED",
  EXPIRED: "EXPIRED",
  WITHDRAWN: "WITHDRAWN",
  CLOSED: null,
};

/** Ato terminado: a aprovação já não interessa (BR-PRC-13); `NO_SHOW` mantém-na (BR-AUT-10). */
const ACT_ENDED: readonly ActFact["phase"][] = ["DONE", "CANCELLED"];

export function deriveCoverageView(facts: { act?: Pick<ActFact, "phase"> | undefined; coverage?: CoverageFact | undefined }): CoverageView | null {
  const { act, coverage } = facts;
  if (coverage === undefined) return null;
  if (act !== undefined && ACT_ENDED.includes(act.phase)) return null;
  const state = STATE_OF_PHASE[coverage.phase];
  if (state === null) return null;
  return {
    state,
    appeal: coverage.appeal,
    partial: state === "APPROVED" && coverage.partial,
    ...(state === "PENDING" && coverage.dueAt ? { dueAt: coverage.dueAt } : {}),
    ...((state === "APPROVED" || state === "EXPIRED") && coverage.validUntil ? { validUntil: coverage.validUntil } : {}),
  };
}
