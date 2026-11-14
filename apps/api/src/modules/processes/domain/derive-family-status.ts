// `deriveFamilyStatus(facts)` — função PURA (BR-PRC-02/03): sem relógio, I/O nem acesso à BD.
// Tabela de verdade em state-machines.md "Process" (6 linhas); fatias seguintes acrescentam factos
// de autorização/despesa à mesma função e linhas à tabela, sem tocar nas existentes.
import type { ActFact, ActPhase, FamilyStatus, NextStep } from "./process.js";

/** Factos de que a derivação precisa; hoje só o facto do ato (`ActFact` cumpre-o estruturalmente). */
export interface FamilyStatusFacts {
  act: Pick<ActFact, "phase">;
}

export interface FamilyView {
  familyStatus: FamilyStatus;
  nextStep: NextStep;
}

/** `Record<ActPhase, …>` obriga o compilador a verificar a totalidade: fase nova sem linha não compila. */
const TRUTH_TABLE: Record<ActPhase, FamilyView> = {
  PENDING: { familyStatus: "SCHEDULED", nextStep: { code: "AWAIT_CLINIC_RESPONSE", actor: "CLINIC" } },
  SCHEDULED: { familyStatus: "SCHEDULED", nextStep: { code: "ATTEND", actor: "FAMILY" } },
  IN_PROGRESS: { familyStatus: "IN_PROGRESS", nextStep: { code: "BEING_ATTENDED", actor: "CLINIC" } },
  DONE: { familyStatus: "DONE", nextStep: { code: "NOTHING_PENDING", actor: "NONE" } },
  CANCELLED: { familyStatus: "CANCELLED", nextStep: { code: "NOTHING_PENDING", actor: "NONE" } },
  // Decisão por defeito (state-machines.md): a falta aparece como "Cancelado" com o passo "voltar a marcar".
  NO_SHOW: { familyStatus: "CANCELLED", nextStep: { code: "RESCHEDULE", actor: "FAMILY" } },
};

export function deriveFamilyStatus(facts: FamilyStatusFacts): FamilyView {
  const row = TRUTH_TABLE[facts.act.phase];
  // Cópia: quem recebe nunca altera a tabela partilhada.
  return { familyStatus: row.familyStatus, nextStep: { ...row.nextStep } };
}
