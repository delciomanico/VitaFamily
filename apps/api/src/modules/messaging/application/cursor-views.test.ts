import { describe, expect, it } from "vitest";
import { DomainError } from "../../../platform/errors/index.js";
import type { Message } from "../domain/message.js";
import {
  decodeConversationCursor,
  decodeSeqCursor,
  encodeConversationCursor,
  encodeSeqCursor,
} from "./cursor.js";
import { toConversationView, toMessageView } from "./views.js";
import type { ConversationRecord, ProfessionalIdentity } from "./ports.js";

const UUID = "7f9c2a4e-1b3d-4c5e-8f6a-9b0c1d2e3f40";
const FAMILY_USER = "11111111-1111-4111-8111-111111111111";
const OTHER_TUTOR = "22222222-2222-4222-8222-222222222222";

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function expectMalformed(fn: () => unknown): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect((caught as DomainError).code).toBe("MALFORMED_REQUEST");
}

function makeConversation(overrides: Partial<ConversationRecord> = {}): ConversationRecord {
  return {
    id: UUID,
    familyId: "33333333-3333-4333-8333-333333333333",
    memberId: "44444444-4444-4444-8444-444444444444",
    professionalId: "55555555-5555-4555-8555-555555555555",
    openedByUserId: FAMILY_USER,
    participantLabel: "Mãe",
    status: "OPEN",
    closedBy: null,
    closedAt: null,
    lastSeq: 10,
    lastProfessionalSeq: 6,
    lastMessageAt: new Date("2026-11-10T12:00:00.000Z"),
    familyReadSeq: 3,
    professionalReadSeq: 5,
    professionalNotifiedAt: null,
    createdAt: new Date("2026-11-01T09:00:00.000Z"),
    ...overrides,
  };
}

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "66666666-6666-4666-8666-666666666666",
    conversationId: UUID,
    seq: 1,
    side: "FAMILY",
    senderUserId: FAMILY_USER,
    body: "Olá, doutor.",
    hiddenAt: null,
    createdAt: new Date("2026-11-10T10:00:00.000Z"),
    ...overrides,
  } as unknown as Message;
}

const APPROVED_IDENTITY: ProfessionalIdentity = {
  id: "55555555-5555-4555-8555-555555555555",
  displayName: "Dra. Ana",
  city: "Lisboa",
  approved: true,
};

describe("cursor de sequência (encodeSeqCursor / decodeSeqCursor)", () => {
  it("ida e volta devolve o mesmo seq", () => {
    expect(decodeSeqCursor(encodeSeqCursor(1))).toBe(1);
    expect(decodeSeqCursor(encodeSeqCursor(42))).toBe(42);
  });

  it("o cursor codificado é base64url sem padding", () => {
    expect(encodeSeqCursor(7)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejeita lixo que não é base64url de JSON", () => {
    expectMalformed(() => decodeSeqCursor("!!!"));
    expectMalformed(() => decodeSeqCursor("isto-nao-e-json"));
  });

  it("rejeita JSON que não é objeto", () => {
    expectMalformed(() => decodeSeqCursor(b64("42")));
    expectMalformed(() => decodeSeqCursor(b64("\"texto\"")));
    expectMalformed(() => decodeSeqCursor(b64("[1]")));
    expectMalformed(() => decodeSeqCursor(b64("null")));
  });

  it("rejeita seq 0", () => {
    expectMalformed(() => decodeSeqCursor(b64(JSON.stringify({ seq: 0 }))));
  });

  it("rejeita seq negativo", () => {
    expectMalformed(() => decodeSeqCursor(b64(JSON.stringify({ seq: -1 }))));
  });

  it("rejeita seq não inteiro", () => {
    expectMalformed(() => decodeSeqCursor(b64(JSON.stringify({ seq: 1.5 }))));
  });

  it("rejeita seq como string", () => {
    expectMalformed(() => decodeSeqCursor(b64(JSON.stringify({ seq: "3" }))));
  });

  it("rejeita objeto sem campo seq", () => {
    expectMalformed(() => decodeSeqCursor(b64(JSON.stringify({ outro: 3 }))));
  });
});

describe("cursor de conversa (encodeConversationCursor / decodeConversationCursor)", () => {
  it("ida e volta preserva a data em milissegundos e o id", () => {
    const at = new Date("2026-11-10T12:34:56.789Z");
    const decoded = decodeConversationCursor(encodeConversationCursor(at, UUID));
    expect(decoded.lastMessageAt).toBeInstanceOf(Date);
    expect(decoded.lastMessageAt.getTime()).toBe(at.getTime());
    expect(decoded.id).toBe(UUID);
  });

  it("o cursor codificado é base64url", () => {
    expect(encodeConversationCursor(new Date("2026-11-10T12:00:00.000Z"), UUID)).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("rejeita id que não é UUID", () => {
    expectMalformed(() => decodeConversationCursor(b64(JSON.stringify({ at: "2026-11-10T12:00:00.000Z", id: "nao-e-uuid" }))));
  });

  it("rejeita data inválida", () => {
    expectMalformed(() => decodeConversationCursor(b64(JSON.stringify({ at: "nao-e-data", id: UUID }))));
  });

  it("rejeita campos em falta", () => {
    expectMalformed(() => decodeConversationCursor(b64(JSON.stringify({ id: UUID }))));
    expectMalformed(() => decodeConversationCursor(b64(JSON.stringify({ at: "2026-11-10T12:00:00.000Z" }))));
    expectMalformed(() => decodeConversationCursor(b64("{}")));
  });

  it("rejeita lixo que não é base64url de JSON", () => {
    expectMalformed(() => decodeConversationCursor("!!!"));
  });
});

describe("toMessageView", () => {
  const conversation = makeConversation();

  it("mine é true só para mensagem FAMILY enviada pelo próprio utilizador", () => {
    const view = toMessageView(makeMessage({ side: "FAMILY", senderUserId: FAMILY_USER }), conversation, FAMILY_USER);
    expect(view.mine).toBe(true);
  });

  it("mine é false quando a mensagem FAMILY foi enviada por outro tutor", () => {
    const view = toMessageView(makeMessage({ side: "FAMILY", senderUserId: OTHER_TUTOR }), conversation, FAMILY_USER);
    expect(view.mine).toBe(false);
  });

  it("mine é false para mensagem do PROFISSIONAL", () => {
    const view = toMessageView(
      makeMessage({ side: "PROFESSIONAL", senderUserId: null }),
      conversation,
      FAMILY_USER,
    );
    expect(view.mine).toBe(false);
  });

  it("mine é false quando senderUserId é null", () => {
    const view = toMessageView(makeMessage({ side: "FAMILY", senderUserId: null }), conversation, FAMILY_USER);
    expect(view.mine).toBe(false);
  });

  it("mensagem oculta (hiddenAt) devolve hidden=true e text=null", () => {
    const view = toMessageView(
      makeMessage({ hiddenAt: new Date("2026-11-11T08:00:00.000Z") }),
      conversation,
      FAMILY_USER,
    );
    expect(view.hidden).toBe(true);
    expect(view.text).toBeNull();
  });

  it("mensagem visível devolve hidden=false e o texto", () => {
    const view = toMessageView(makeMessage(), conversation, FAMILY_USER);
    expect(view.hidden).toBe(false);
    expect(view.text).toBe("Olá, doutor.");
  });

  it("nunca inclui senderUserId nem conversationId", () => {
    const view = toMessageView(makeMessage(), conversation, FAMILY_USER);
    expect(Object.keys(view)).not.toContain("senderUserId");
    expect(Object.keys(view)).not.toContain("conversationId");
  });

  it("readByOtherSide: mensagem FAMILY com seq <= professionalReadSeq está lida", () => {
    const read = toMessageView(makeMessage({ side: "FAMILY", seq: 5 }), conversation, FAMILY_USER);
    expect(read.readByOtherSide).toBe(true);
  });

  it("readByOtherSide: mensagem FAMILY com seq > professionalReadSeq não está lida", () => {
    const unread = toMessageView(makeMessage({ side: "FAMILY", seq: 6 }), conversation, FAMILY_USER);
    expect(unread.readByOtherSide).toBe(false);
  });

  it("readByOtherSide: mensagem PROFESSIONAL com seq <= familyReadSeq está lida", () => {
    const read = toMessageView(
      makeMessage({ side: "PROFESSIONAL", senderUserId: null, seq: 3 }),
      conversation,
      FAMILY_USER,
    );
    expect(read.readByOtherSide).toBe(true);
  });

  it("readByOtherSide: mensagem PROFESSIONAL com seq > familyReadSeq não está lida", () => {
    const unread = toMessageView(
      makeMessage({ side: "PROFESSIONAL", senderUserId: null, seq: 4 }),
      conversation,
      FAMILY_USER,
    );
    expect(unread.readByOtherSide).toBe(false);
  });
});

describe("toConversationView", () => {
  it("canSend é true só com estado OPEN e profissional aprovado", () => {
    const view = toConversationView(makeConversation({ status: "OPEN" }), APPROVED_IDENTITY, 0);
    expect(view.canSend).toBe(true);
  });

  it("canSend é false com profissional não aprovado", () => {
    const view = toConversationView(makeConversation({ status: "OPEN" }), { ...APPROVED_IDENTITY, approved: false }, 0);
    expect(view.canSend).toBe(false);
  });

  it("canSend é false com conversa CLOSED mesmo com profissional aprovado", () => {
    const view = toConversationView(
      makeConversation({ status: "CLOSED", closedBy: "FAMILY", closedAt: new Date("2026-11-12T10:00:00.000Z") }),
      APPROVED_IDENTITY,
      0,
    );
    expect(view.canSend).toBe(false);
  });

  it("sem identidade usa displayName 'Profissional', city null e canSend false", () => {
    const view = toConversationView(makeConversation(), undefined, 0);
    expect(view.professional.displayName).toBe("Profissional");
    expect(view.professional.city).toBeNull();
    expect(view.canSend).toBe(false);
  });

  it("com identidade devolve displayName, city e id público do profissional", () => {
    const view = toConversationView(makeConversation(), APPROVED_IDENTITY, 2);
    expect(view.professional).toEqual({ id: APPROVED_IDENTITY.id, displayName: "Dra. Ana", city: "Lisboa" });
    expect(view.unreadCount).toBe(2);
  });

  it("propaga closedBy", () => {
    const view = toConversationView(
      makeConversation({ status: "CLOSED", closedBy: "PROFESSIONAL", closedAt: new Date("2026-11-12T10:00:00.000Z") }),
      APPROVED_IDENTITY,
      0,
    );
    expect(view.closedBy).toBe("PROFESSIONAL");
  });

  it("closedBy é null em conversa aberta", () => {
    const view = toConversationView(makeConversation(), APPROVED_IDENTITY, 0);
    expect(view.closedBy).toBeNull();
  });

  it("datas saem em ISO", () => {
    const view = toConversationView(makeConversation(), APPROVED_IDENTITY, 0);
    expect(view.lastMessageAt).toBe("2026-11-10T12:00:00.000Z");
    expect(view.createdAt).toBe("2026-11-01T09:00:00.000Z");
  });

  it("nunca inclui familyId nem openedByUserId", () => {
    const view = toConversationView(makeConversation(), APPROVED_IDENTITY, 0);
    expect(Object.keys(view)).not.toContain("familyId");
    expect(Object.keys(view)).not.toContain("openedByUserId");
  });
});
