// `deriveFamilyStatus(facts)` — função PURA (BR-PRC-02/03): sem relógio, I/O nem acesso à BD.
// Tabela de verdade em state-machines.md "Process": tabela 2 (6 linhas do ato). A tabela 3 (cobertura) saiu no arquivo do marco B (R3).
import type { ActFact, ActPhase, FamilyStatus, NextStep } from "./process.js";

/** Factos de que a derivação precisa: só o ato. */
export interface FamilyStatusFacts {
  act: Pick<ActFact, "phase">;
}

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

export function deriveFamilyStatus(facts: FamilyStatusFacts): FamilyView {
  // Cópia: quem recebe nunca altera a tabela partilhada.
  const row = ACT_TABLE[facts.act.phase];
  return { familyStatus: row.familyStatus, nextStep: { ...row.nextStep } };
}
