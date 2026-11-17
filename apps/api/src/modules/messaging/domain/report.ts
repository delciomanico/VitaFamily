// Denúncia e moderação mínima (state-machines.md «MessageReport», BR-MKT-44, OP-76). Puro. O admin só vê a mensagem denunciada e as 2
// imediatamente anteriores DA MESMA CONVERSA (por `seq`); nunca posteriores, mais antigas, nem outras conversas.
import type { Side } from "./conversation.js";
import type { Message } from "./message.js";

export const REPORT_REASONS = ["ABUSE", "SPAM", "SCAM_OR_OFF_PLATFORM_PAYMENT", "SENSITIVE_DATA", "OTHER"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_DECISIONS = ["DISMISS", "HIDE_MESSAGE", "HIDE_AND_CLOSE"] as const;
export type ReportDecision = (typeof REPORT_DECISIONS)[number];
export type ReportStatus = "OPEN" | "DECIDED";

export interface ReportState {
  status: ReportStatus;
  decision: ReportDecision | null;
}

export const MODERATION_CONTEXT_SIZE = 2;

export type ReportError = "OWN_MESSAGE" | "INVALID_STATE_TRANSITION";

/** Só se denuncia uma mensagem do OUTRO lado. */
export function canReport(reporterSide: Side, messageSide: Side): boolean {
  return reporterSide !== messageSide;
}

/** Decisão do admin: só `OPEN → DECIDED`, definitiva (a segunda decisão, concorrente ou não, ⇒ `INVALID_STATE_TRANSITION`). */
export function decideReport(state: ReportState, decision: ReportDecision): { ok: true; state: ReportState } | { ok: false; error: ReportError } {
  if (state.status !== "OPEN") return { ok: false, error: "INVALID_STATE_TRANSITION" };
  return { ok: true, state: { status: "DECIDED", decision } };
}

/** Efeitos da decisão sobre a mensagem e a conversa. */
export function decisionEffects(decision: ReportDecision): { hideMessage: boolean; closeConversation: boolean } {
  return { hideMessage: decision !== "DISMISS", closeConversation: decision === "HIDE_AND_CLOSE" };
}

/** Uma denúncia por (mensagem, lado): repetir devolve a existente. */
export function findExistingReport<R extends { messageId: string; reporterSide: Side }>(existing: readonly R[], messageId: string, reporterSide: Side): R | null {
  return existing.find((r) => r.messageId === messageId && r.reporterSide === reporterSide) ?? null;
}

export interface ContextMessage {
  id: string;
  seq: number;
  side: Side;
  /** `null` se a mensagem está oculta por moderação (ocupa o lugar, `hidden = true`). */
  text: string | null;
  hidden: boolean;
  createdAt: Date;
}

/** Contexto de moderação: até 2 mensagens da conversa com o maior `seq` ESTRITAMENTE inferior ao da denunciada, por `seq` crescente. */
export function moderationContext(messages: readonly Message[], reported: Pick<Message, "conversationId" | "seq">): ContextMessage[] {
  return messages
    .filter((m) => m.conversationId === reported.conversationId && m.seq < reported.seq)
    .sort((a, b) => b.seq - a.seq)
    .slice(0, MODERATION_CONTEXT_SIZE)
    .sort((a, b) => a.seq - b.seq)
    .map((m) => ({ id: m.id, seq: m.seq, side: m.side, text: m.hiddenAt === null ? m.body : null, hidden: m.hiddenAt !== null, createdAt: m.createdAt }));
}
