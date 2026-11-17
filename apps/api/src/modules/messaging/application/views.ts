// Vistas devolvidas à família (openapi.yaml: FamilyConversation, ChatMessage). Só a `application` decide o que sai: nunca o id do
// utilizador autor, nunca ids do lado do profissional além do id público (BR-MKT-38/46).
import { canSend, readByOtherSide, type ConversationState } from "../domain/conversation.js";
import { visibleBody, type Message } from "../domain/message.js";
import type { ConversationRecord, ProfessionalIdentity } from "./ports.js";

export interface FamilyConversationView {
  id: string;
  memberId: string;
  professional: { id: string; displayName: string; city: string | null };
  participantLabel: string;
  status: "OPEN" | "CLOSED";
  closedBy: "FAMILY" | "PROFESSIONAL" | "SYSTEM" | null;
  canSend: boolean;
  lastMessageAt: string;
  unreadCount: number;
  createdAt: string;
}

export interface ChatMessageView {
  id: string;
  seq: number;
  side: "FAMILY" | "PROFESSIONAL";
  mine: boolean;
  text: string | null;
  hidden: boolean;
  createdAt: string;
  readByOtherSide: boolean;
}

export function toState(conversation: ConversationRecord): ConversationState {
  return { status: conversation.status, closedBy: conversation.closedBy, lastSeq: conversation.lastSeq, familyReadSeq: conversation.familyReadSeq, professionalReadSeq: conversation.professionalReadSeq };
}

export function toConversationView(conversation: ConversationRecord, identity: ProfessionalIdentity | undefined, unreadCount: number): FamilyConversationView {
  return {
    id: conversation.id,
    memberId: conversation.memberId,
    professional: { id: conversation.professionalId, displayName: identity?.displayName ?? "Profissional", city: identity?.city ?? null },
    participantLabel: conversation.participantLabel,
    status: conversation.status,
    closedBy: conversation.closedBy,
    canSend: canSend(conversation, identity?.approved ?? false),
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    unreadCount,
    createdAt: conversation.createdAt.toISOString(),
  };
}

export function toMessageView(message: Message, conversation: ConversationRecord, viewerUserId: string): ChatMessageView {
  return {
    id: message.id,
    seq: message.seq,
    side: message.side,
    mine: message.side === "FAMILY" && message.senderUserId === viewerUserId,
    text: visibleBody(message),
    hidden: message.hiddenAt !== null,
    createdAt: message.createdAt.toISOString(),
    readByOtherSide: readByOtherSide(toState(conversation), message),
  };
}
