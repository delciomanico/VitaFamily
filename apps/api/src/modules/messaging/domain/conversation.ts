// Conversa família ↔ profissional (state-machines.md «Conversation», BR-MKT-38..43/47). Puro: sem I/O, sem relógio (instantes por parâmetro).
// `status`/`closedBy` mudam SÓ por estas transições; o efeito de o profissional deixar de estar `APPROVED` é DERIVADO (`canSend`), nunca gravado.

export type Side = "FAMILY" | "PROFESSIONAL";
export type ConversationStatus = "OPEN" | "CLOSED";
export type ClosedBy = "FAMILY" | "PROFESSIONAL" | "SYSTEM";

export interface ConversationState {
  status: ConversationStatus;
  /** Nulo se e só se `status = OPEN` (CHECK da migração 0044). */
  closedBy: ClosedBy | null;
  /** `seq` da última mensagem (0 = sem mensagens; uma conversa nunca existe sem mensagens, BR-MKT-39). */
  lastSeq: number;
  familyReadSeq: number;
  professionalReadSeq: number;
}

export type TransitionError = "INVALID_STATE_TRANSITION";
export type TransitionResult = { ok: true; state: ConversationState } | { ok: false; error: TransitionError };

/** Fechar: `OPEN → CLOSED` por `FAMILY` ou `PROFESSIONAL` (BR-MKT-43). Fechar uma fechada é inválido. */
export function closeConversation(state: ConversationState, by: Side): TransitionResult {
  if (state.status !== "OPEN") return { ok: false, error: "INVALID_STATE_TRANSITION" };
  return { ok: true, state: { ...state, status: "CLOSED", closedBy: by } };
}

/** Reabrir: só o lado que fechou; `SYSTEM` nunca se reabre em MK2; reabrir uma aberta é inválido. */
export function reopenConversation(state: ConversationState, by: Side): TransitionResult {
  if (state.status !== "CLOSED" || state.closedBy !== by) return { ok: false, error: "INVALID_STATE_TRANSITION" };
  return { ok: true, state: { ...state, status: "OPEN", closedBy: null } };
}

/** Fecho por moderação (`HIDE_AND_CLOSE`): passa a `SYSTEM` mesmo que já estivesse fechada por um lado (assim ninguém a reabre; OP-91). */
export function closeBySystem(state: ConversationState): ConversationState {
  return { ...state, status: "CLOSED", closedBy: "SYSTEM" };
}

export type SendBlock = "CONVERSATION_CLOSED" | "PROFESSIONAL_LOCKED";

/**
 * Quem pode enviar (BR-MKT-39/47): conversa `OPEN` e profissional `APPROVED` (lido em cada pedido). Família: fechada OU profissional
 * não aprovado ⇒ `CONVERSATION_CLOSED`. Profissional: não aprovado ⇒ `PROFESSIONAL_LOCKED` (tem precedência); fechada ⇒ `CONVERSATION_CLOSED`.
 */
export function sendBlock(state: Pick<ConversationState, "status">, side: Side, professionalApproved: boolean): SendBlock | null {
  if (side === "PROFESSIONAL" && !professionalApproved) return "PROFESSIONAL_LOCKED";
  if (state.status !== "OPEN") return "CONVERSATION_CLOSED";
  if (!professionalApproved) return "CONVERSATION_CLOSED";
  return null;
}

/** `canSend` derivado (igual para os dois lados). */
export function canSend(state: Pick<ConversationState, "status">, professionalApproved: boolean): boolean {
  return state.status === "OPEN" && professionalApproved;
}

/** Próximo `seq`: sempre `lastSeq + 1` (sem lacunas nem repetições; atribuído sob o bloqueio da linha da conversa). */
export function nextSeq(lastSeq: number): number {
  return lastSeq + 1;
}

export type ReadError = "OUT_OF_RANGE";

/**
 * Marcador de leitura do lado do chamador (BR-MKT-40): `upToSeq` omitido = `lastSeq`; nunca recua (um valor inferior ao atual mantém
 * o atual); fora de `0..lastSeq` ⇒ `OUT_OF_RANGE` (422 na application). O marcador do outro lado nunca muda.
 */
export function advanceRead(state: ConversationState, side: Side, upToSeq?: number): { ok: true; state: ConversationState } | { ok: false; error: ReadError } {
  const target = upToSeq ?? state.lastSeq;
  if (!Number.isInteger(target) || target < 0 || target > state.lastSeq) return { ok: false, error: "OUT_OF_RANGE" };
  if (side === "FAMILY") return { ok: true, state: { ...state, familyReadSeq: Math.max(state.familyReadSeq, target) } };
  return { ok: true, state: { ...state, professionalReadSeq: Math.max(state.professionalReadSeq, target) } };
}

export interface MessageRef {
  seq: number;
  side: Side;
}

/** `unreadCount` de um lado = mensagens do OUTRO lado com `seq` > o marcador desse lado. */
export function unreadCount(state: ConversationState, side: Side, messages: readonly MessageRef[]): number {
  const readSeq = side === "FAMILY" ? state.familyReadSeq : state.professionalReadSeq;
  return messages.filter((m) => m.side !== side && m.seq > readSeq).length;
}

/** Uma mensagem é `readByOtherSide` se `seq` ≤ marcador do outro lado (só faz sentido para mensagens do próprio lado). */
export function readByOtherSide(state: ConversationState, message: MessageRef): boolean {
  const otherRead = message.side === "FAMILY" ? state.professionalReadSeq : state.familyReadSeq;
  return message.seq <= otherRead;
}

/** Invariantes de uma linha de conversa (espelham os CHECK da migração 0044; usados nos testes e nas fixtures). */
export function isConsistent(state: ConversationState): boolean {
  return (
    (state.status === "OPEN") === (state.closedBy === null) &&
    state.lastSeq >= 0 &&
    state.familyReadSeq >= 0 &&
    state.professionalReadSeq >= 0 &&
    state.familyReadSeq <= state.lastSeq &&
    state.professionalReadSeq <= state.lastSeq
  );
}

/** Aviso ao profissional por e-mail: no máximo 1 cada 30 min por conversa (BR-MKT-41). */
export const PROFESSIONAL_NOTIFY_INTERVAL_MS = 30 * 60_000;

export function shouldNotifyProfessional(lastNotifiedAtMs: number | null, nowMs: number): boolean {
  return lastNotifiedAtMs === null || nowMs - lastNotifiedAtMs >= PROFESSIONAL_NOTIFY_INTERVAL_MS;
}
