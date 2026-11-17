// Limites e anti-abuso do chat (BR-MKT-42, PROPOSTA OP-80). Funções PURAS: os contadores e carimbos vêm da repositório; aqui só se decide.
// Excesso de taxa ⇒ `RATE_LIMITED` (429, com `retryAfterMs`); excesso de contadores ⇒ `LIMIT_EXCEEDED` (409).
import type { Side } from "./conversation.js";

export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

export const CHAT_LIMITS = {
  family: { perConversationPerHour: 30, perUserPerDay: 200, newConversationsPer24h: 5, openPerSubject: 20, maxConsecutiveWithoutReply: 3 },
  professional: { perConversationPerHour: 60, perUserPerDay: 300 },
  reportsPerSidePerDay: 10,
} as const;

export type LimitDecision = { ok: true } | { ok: false; kind: "RATE_LIMITED"; retryAfterMs: number } | { ok: false; kind: "LIMIT_EXCEEDED"; detail: string };

/** Janela deslizante sobre carimbos (ms): se já há `max` na janela, o tempo até o mais antigo sair. */
export function windowDecision(timestampsMs: readonly number[], nowMs: number, max: number, windowMs: number): { ok: true } | { ok: false; retryAfterMs: number } {
  const inside = timestampsMs.filter((t) => t > nowMs - windowMs).sort((a, b) => a - b);
  if (inside.length < max) return { ok: true };
  const blocking = inside[inside.length - max] ?? nowMs;
  return { ok: false, retryAfterMs: Math.max(1, blocking + windowMs - nowMs) };
}

export interface SendLimitInput {
  side: Side;
  nowMs: number;
  /** Carimbos das mensagens DESTE lado na conversa (última hora relevante). */
  conversationMessageTimes: readonly number[];
  /** Carimbos das mensagens do utilizador/profissional no último dia (todas as conversas). */
  senderDayMessageTimes: readonly number[];
  /** Família: mensagens consecutivas da família no fim da conversa sem resposta do profissional. */
  consecutiveFamilyWithoutReply: number;
}

export const WAIT_FOR_REPLY_DETAIL = "Aguarde a resposta do profissional.";

/** Ordem: streak (409) → hora por conversa (429) → dia (429). */
export function checkSendLimits(input: SendLimitInput): LimitDecision {
  const rule = input.side === "FAMILY" ? CHAT_LIMITS.family : CHAT_LIMITS.professional;
  if (input.side === "FAMILY" && input.consecutiveFamilyWithoutReply >= CHAT_LIMITS.family.maxConsecutiveWithoutReply) {
    return { ok: false, kind: "LIMIT_EXCEEDED", detail: WAIT_FOR_REPLY_DETAIL };
  }
  const hour = windowDecision(input.conversationMessageTimes, input.nowMs, rule.perConversationPerHour, HOUR_MS);
  if (!hour.ok) return { ok: false, kind: "RATE_LIMITED", retryAfterMs: hour.retryAfterMs };
  const day = windowDecision(input.senderDayMessageTimes, input.nowMs, rule.perUserPerDay, DAY_MS);
  if (!day.ok) return { ok: false, kind: "RATE_LIMITED", retryAfterMs: day.retryAfterMs };
  return { ok: true };
}

export interface OpenLimitInput {
  nowMs: number;
  /** Carimbos de criação das conversas novas do utilizador (últimas 24 h). */
  newConversationTimes: readonly number[];
  /** Conversas `OPEN` do membro-sujeito. */
  openForSubject: number;
}

/** Abrir uma conversa NOVA (continuar uma existente não passa por aqui). */
export function checkOpenLimits(input: OpenLimitInput): LimitDecision {
  if (input.openForSubject >= CHAT_LIMITS.family.openPerSubject) return { ok: false, kind: "LIMIT_EXCEEDED", detail: "Atingiu o limite de conversas abertas deste membro." };
  const day = windowDecision(input.newConversationTimes, input.nowMs, CHAT_LIMITS.family.newConversationsPer24h, DAY_MS);
  if (!day.ok) return { ok: false, kind: "RATE_LIMITED", retryAfterMs: day.retryAfterMs };
  return { ok: true };
}

/** Denúncias: ≤ 10/dia por lado (BR-MKT-42). */
export function checkReportLimit(reportTimesMs: readonly number[], nowMs: number): LimitDecision {
  const d = windowDecision(reportTimesMs, nowMs, CHAT_LIMITS.reportsPerSidePerDay, DAY_MS);
  return d.ok ? { ok: true } : { ok: false, kind: "RATE_LIMITED", retryAfterMs: d.retryAfterMs };
}

/** Mensagens consecutivas da família no fim da conversa (contadas do fim até à primeira do profissional). Entrada por `seq` crescente. */
export function consecutiveFamilyWithoutReply(messages: readonly { seq: number; side: Side }[]): number {
  let count = 0;
  for (const m of [...messages].sort((a, b) => b.seq - a.seq)) {
    if (m.side !== "FAMILY") break;
    count += 1;
  }
  return count;
}
