// `deriveFamilyStatus(facts)` — função PURA (BR-PRC-02/03): sem relógio, I/O nem acesso à BD.
// Tabela de verdade em state-machines.md "Process": tabela 2 (6 linhas do ato) e 2b (linhas de `BOOKING` com `hint`, MK3). A tabela 3 (cobertura) saiu no arquivo do marco B (R3).
import type { ActFact, ActPhase, BookingHint, FamilyStatus, NextStep } from "./process.js";

/** Factos de que a derivação precisa: só o ato. */
export interface FamilyStatusFacts {
  act: Pick<ActFact, "phase"> & Partial<Pick<ActFact, "source" | "hint">>;
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

type HintRow = Partial<Record<BookingHint, FamilyView>>;
const BOOKING_PAYMENT_HINTS = (status: FamilyStatus): HintRow => ({
  PAYMENT_PROOF_DUE: { familyStatus: status, nextStep: { code: "SEND_PAYMENT_PROOF", actor: "FAMILY" } },
  PAYMENT_UNDER_REVIEW: { familyStatus: status, nextStep: { code: "AWAIT_PAYMENT_CONFIRMATION", actor: "PROFESSIONAL" } },
  PAYMENT_DISPUTED: { familyStatus: status, nextStep: { code: "AWAIT_PAYMENT_DISPUTE_DECISION", actor: "PLATFORM" } },
});

/**
 * Linhas de `BOOKING` (2b): a linha base por `phase` e, por cima, as `hint` permitidas nessa fase. `hint` fora das combinações listadas
 * (p. ex. com `PENDING`/`CANCELLED`) é ignorado; `IN_PROGRESS` não existe para marcações (cai na tabela do ato). A função é total.
 */
const BOOKING_BASE: Partial<Record<ActPhase, FamilyView>> = {
  PENDING: { familyStatus: "SCHEDULED", nextStep: { code: "AWAIT_PROFESSIONAL_RESPONSE", actor: "PROFESSIONAL" } },
  SCHEDULED: ACT_TABLE.SCHEDULED,
  DONE: ACT_TABLE.DONE,
  CANCELLED: ACT_TABLE.CANCELLED,
  NO_SHOW: ACT_TABLE.NO_SHOW,
};
const BOOKING_HINT_ROWS: Partial<Record<ActPhase, HintRow>> = {
  SCHEDULED: BOOKING_PAYMENT_HINTS("SCHEDULED"),
  DONE: { ...BOOKING_PAYMENT_HINTS("DONE"), REVIEW_DUE: { familyStatus: "DONE", nextStep: { code: "LEAVE_REVIEW", actor: "FAMILY" } } },
};

export function deriveFamilyStatus(facts: FamilyStatusFacts): FamilyView {
  const { phase, source, hint } = facts.act;
  let row: FamilyView = ACT_TABLE[phase];
  if (source === "BOOKING") {
    const base = BOOKING_BASE[phase];
    if (base) row = (hint ? BOOKING_HINT_ROWS[phase]?.[hint] : undefined) ?? base;
  }
  // Cópia: quem recebe nunca altera a tabela partilhada.
  return { familyStatus: row.familyStatus, nextStep: { ...row.nextStep } };
}
