// `deriveFamilyStatus(facts)` — função PURA (BR-PRC-02/03): sem relógio, I/O nem acesso à BD.
// Tabela de verdade em state-machines.md "Process": tabela 2 (6 linhas do ato, fatia 1, inalteradas) e tabela 3 (fatia 3:
// o facto de cobertura). Fatias seguintes acrescentam factos e linhas sem tocar nas existentes.
import type { ActFact, ActPhase, CoverageFact, CoveragePhase, FamilyStatus, NextStep } from "./process.js";

/** Factos de que a derivação precisa. Sem ato (origem `AUTHORIZATION`), só a cobertura — nunca nenhum dos dois. */
export type FamilyStatusFacts = { act: Pick<ActFact, "phase">; coverage?: Pick<CoverageFact, "phase" | "dueAt"> } | { act?: undefined; coverage: Pick<CoverageFact, "phase" | "dueAt"> };

export interface FamilyView {
  familyStatus: FamilyStatus;
  nextStep: NextStep;
}

/** `Record<ActPhase, …>` obriga o compilador a verificar a totalidade: fase nova sem linha não compila. */
const ACT_TABLE: Record<ActPhase, FamilyView> = {
  PENDING: { familyStatus: "SCHEDULED", nextStep: { code: "AWAIT_CLINIC_RESPONSE", actor: "CLINIC" } },
  SCHEDULED: { familyStatus: "SCHEDULED", nextStep: { code: "ATTEND", actor: "FAMILY" } },
  IN_PROGRESS: { familyStatus: "IN_PROGRESS", nextStep: { code: "BEING_ATTENDED", actor: "CLINIC" } },
  DONE: { familyStatus: "DONE", nextStep: { code: "NOTHING_PENDING", actor: "NONE" } },
  CANCELLED: { familyStatus: "CANCELLED", nextStep: { code: "NOTHING_PENDING", actor: "NONE" } },
  // Decisão por defeito (state-machines.md): a falta aparece como "Cancelado" com o passo "voltar a marcar".
  NO_SHOW: { familyStatus: "CANCELLED", nextStep: { code: "RESCHEDULE", actor: "FAMILY" } },
};

/** Sem ato (tabela 3, linhas «sem ato»): totalidade verificada em compilação. */
const COVERAGE_ONLY_TABLE: Record<CoveragePhase, FamilyView> = {
  PENDING_DECISION: { familyStatus: "IN_PROGRESS", nextStep: { code: "AWAIT_INSURER_DECISION", actor: "INSURER" } },
  NEEDS_INFO: { familyStatus: "IN_PROGRESS", nextStep: { code: "AWAIT_CLINIC_INFORMATION", actor: "CLINIC" } },
  NOT_APPROVED: { familyStatus: "IN_PROGRESS", nextStep: { code: "COVERAGE_NOT_APPROVED", actor: "CLINIC" } },
  APPROVED: { familyStatus: "IN_PROGRESS", nextStep: { code: "ATTEND", actor: "FAMILY" } },
  CLOSED: { familyStatus: "CANCELLED", nextStep: { code: "NOTHING_PENDING", actor: "NONE" } },
};

/** Com ato por começar (`PENDING`/`SCHEDULED`): só as três fases que ainda travam o ato mudam a linha; as restantes mantêm a do ato. */
const COVERAGE_OVER_ACT_TABLE: Partial<Record<CoveragePhase, FamilyView>> = {
  PENDING_DECISION: COVERAGE_ONLY_TABLE.PENDING_DECISION,
  NEEDS_INFO: COVERAGE_ONLY_TABLE.NEEDS_INFO,
  NOT_APPROVED: COVERAGE_ONLY_TABLE.NOT_APPROVED,
};

const ACT_NOT_STARTED: readonly ActPhase[] = ["PENDING", "SCHEDULED"];

function copy(row: FamilyView, dueAt: Date | undefined): FamilyView {
  // Cópia: quem recebe nunca altera a tabela partilhada.
  const nextStep: NextStep = { ...row.nextStep };
  if (row.nextStep.code === "AWAIT_INSURER_DECISION" && dueAt !== undefined) nextStep.dueAt = dueAt;
  return { familyStatus: row.familyStatus, nextStep };
}

export function deriveFamilyStatus(facts: FamilyStatusFacts): FamilyView {
  const { act, coverage } = facts;
  if (act === undefined) return copy(COVERAGE_ONLY_TABLE[coverage.phase], coverage.dueAt);
  const override = coverage !== undefined && ACT_NOT_STARTED.includes(act.phase) ? COVERAGE_OVER_ACT_TABLE[coverage.phase] : undefined;
  return override !== undefined ? copy(override, coverage?.dueAt) : copy(ACT_TABLE[act.phase], undefined);
}
