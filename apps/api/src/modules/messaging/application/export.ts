// Conversas de um membro para a exportação do titular (BR-MKT-45, TC-MKT-67). Reutiliza os casos de uso da família (mesma autorização
// `MESSAGE_PROFESSIONALS`: só SELF/TUTOR_OF; relação insuficiente ⇒ lança e o `lifecycle` omite a secção). Sem ids de utilizador.
import type { FamilyMessaging } from "./family-conversations.js";
import type { ActorIdentity } from "./ports.js";

export async function exportConversations(useCases: FamilyMessaging, actor: ActorIdentity, familyId: string, memberId: string): Promise<Record<string, unknown>[]> {
  const result: Record<string, unknown>[] = [];
  let conversationCursor: string | undefined;
  do {
    const page = await useCases.listConversations(actor, familyId, memberId, { limit: 100, ...(conversationCursor ? { cursor: conversationCursor } : {}) });
    for (const conversation of page.items) {
      const messages: Record<string, unknown>[] = [];
      let messageCursor: string | undefined;
      do {
        const batch = await useCases.listMessages(actor, familyId, memberId, conversation.id, { limit: 100, ...(messageCursor ? { cursor: messageCursor } : {}) });
        for (const m of batch.items) messages.push({ seq: m.seq, side: m.side, text: m.text, hidden: m.hidden, createdAt: m.createdAt });
        messageCursor = batch.nextCursor ?? undefined;
      } while (messageCursor);
      messages.reverse();
      result.push({
        id: conversation.id,
        participantLabel: conversation.participantLabel,
        professional: { displayName: conversation.professional.displayName, city: conversation.professional.city },
        status: conversation.status,
        createdAt: conversation.createdAt,
        lastMessageAt: conversation.lastMessageAt,
        messages,
      });
    }
    conversationCursor = page.nextCursor ?? undefined;
  } while (conversationCursor);
  return result;
}
