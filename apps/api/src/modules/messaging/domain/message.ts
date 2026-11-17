// Mensagem (BR-MKT-39/44): imutável; o único efeito é `hiddenAt` por moderação (irreversível em MK2). Idempotência por `clientMessageId`.
import type { Side } from "./conversation.js";

export interface Message {
  id: string;
  conversationId: string;
  seq: number;
  side: Side;
  /** Só `FAMILY` tem autor (`User`); anulado se a conta for eliminada. O profissional nunca recebe este id. */
  senderUserId: string | null;
  body: string;
  clientMessageId: string | null;
  hiddenAt: Date | null;
  createdAt: Date;
}

/**
 * Idempotência de envio (`UNIQUE (conversationId, clientMessageId)`): repetir o mesmo `clientMessageId` devolve a mensagem já guardada
 * (sem duplicar nem notificar). Sem `clientMessageId` nunca há deduplicação. Outra conversa com o mesmo id não conta.
 */
export function findIdempotent(existing: readonly Message[], conversationId: string, clientMessageId: string | null | undefined): Message | null {
  if (clientMessageId === null || clientMessageId === undefined) return null;
  return existing.find((m) => m.conversationId === conversationId && m.clientMessageId === clientMessageId) ?? null;
}

/** Texto visível: uma mensagem oculta por moderação perde o texto (`hidden=true` e sem texto) para todos os leitores. */
export function visibleBody(message: Pick<Message, "body" | "hiddenAt">): string | null {
  return message.hiddenAt === null ? message.body : null;
}

/** `seq` sem lacunas nem repetições: `1..n` por ordem. */
export function hasContiguousSeq(messages: readonly Pick<Message, "seq">[]): boolean {
  return [...messages].sort((a, b) => a.seq - b.seq).every((m, i) => m.seq === i + 1);
}
