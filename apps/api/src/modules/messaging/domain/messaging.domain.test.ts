// Testes de domínio de `messaging` (MK2 S5; TC-MKT-56/57/61/62 ao nível U): texto, estados, `seq`, idempotência, lido por lado, limites e denúncia.
import { describe, expect, it } from "vitest";
import { advanceRead, canSend, closeBySystem, closeConversation, isConsistent, nextSeq, readByOtherSide, reopenConversation, sendBlock, shouldNotifyProfessional, unreadCount, type ClosedBy, type ConversationState, type Side } from "./conversation.js";
import { CHAT_LIMITS, checkOpenLimits, checkReportLimit, checkSendLimits, consecutiveFamilyWithoutReply, DAY_MS, HOUR_MS, windowDecision } from "./limits.js";
import { findIdempotent, hasContiguousSeq, visibleBody, type Message } from "./message.js";
import { canReport, decideReport, decisionEffects, findExistingReport, moderationContext } from "./report.js";
import { validateMessageText, validateParticipantLabel, validateReportNote } from "./text.js";

const open = (over: Partial<ConversationState> = {}): ConversationState => ({ status: "OPEN", closedBy: null, lastSeq: 5, familyReadSeq: 0, professionalReadSeq: 0, ...over });
const closed = (by: ClosedBy): ConversationState => open({ status: "CLOSED", closedBy: by });
const msg = (seq: number, side: Side = "FAMILY", over: Partial<Message> = {}): Message => ({ id: `m${String(seq)}`, conversationId: "c1", seq, side, senderUserId: null, body: `texto ${String(seq)}`, clientMessageId: null, hiddenAt: null, createdAt: new Date(2026, 10, 17, 10, seq), ...over });

describe("texto (BR-MKT-39)", () => {
  it.each([
    ["a", true],
    ["  ola  ", true],
    ["linha1\nlinha2", true],
    ["linha1\r\nlinha2", true],
    ["😀".repeat(1000), true],
    ["a".repeat(1000), true],
    ["a".repeat(1001), false],
    ["😀".repeat(1001), false],
    ["", false],
    ["   \n  ", false],
    ["a\u0000b", false],
    ["a\tb", false],
    ["a\u001Bb", false],
    ["a\u0085b", false],
  ])("mensagem %j válida=%s", (raw, ok) => {
    expect(validateMessageText(raw).ok).toBe(ok);
  });
  it("apara espaços, normaliza quebras de linha e nunca devolve o texto num erro", () => {
    expect(validateMessageText("  a\r\nb  ")).toEqual({ ok: true, text: "a\nb" });
    expect(validateMessageText("segredo\u0000")).toEqual({ ok: false, error: "CONTROL_CHARACTER" });
    expect(JSON.stringify(validateMessageText("   "))).not.toContain("   ");
    expect(validateMessageText("")).toEqual({ ok: false, error: "EMPTY" });
    expect(validateMessageText("a".repeat(1001))).toEqual({ ok: false, error: "TOO_LONG" });
  });
  it("participantLabel 1–40 de uma linha; nota da denúncia ≤ 300 ou nula", () => {
    expect(validateParticipantLabel(" Ana ")).toEqual({ ok: true, text: "Ana" });
    expect(validateParticipantLabel("a".repeat(40)).ok).toBe(true);
    expect(validateParticipantLabel("a".repeat(41)).ok).toBe(false);
    expect(validateParticipantLabel("a\nb").ok).toBe(false);
    expect(validateParticipantLabel("  ").ok).toBe(false);
    expect(validateReportNote(undefined)).toEqual({ ok: true, note: null });
    expect(validateReportNote("   ")).toEqual({ ok: true, note: null });
    expect(validateReportNote("a".repeat(300)).ok).toBe(true);
    expect(validateReportNote("a".repeat(301)).ok).toBe(false);
  });
});

describe("máquina de estados (state-machines.md; TC-MKT-62)", () => {
  const sides: Side[] = ["FAMILY", "PROFESSIONAL"];
  it.each(sides)("fechar uma aberta por %s ⇒ CLOSED(closedBy=%s)", (side) => {
    const r = closeConversation(open(), side);
    expect(r).toMatchObject({ ok: true, state: { status: "CLOSED", closedBy: side } });
    if (r.ok) expect(isConsistent(r.state)).toBe(true);
  });
  it.each(["FAMILY", "PROFESSIONAL", "SYSTEM"] as const)("fechar uma fechada (%s) é inválido", (by) => {
    for (const side of sides) expect(closeConversation(closed(by), side)).toEqual({ ok: false, error: "INVALID_STATE_TRANSITION" });
  });
  const reopenTable: [ClosedBy, Side, boolean][] = [
    ["FAMILY", "FAMILY", true],
    ["FAMILY", "PROFESSIONAL", false],
    ["PROFESSIONAL", "PROFESSIONAL", true],
    ["PROFESSIONAL", "FAMILY", false],
    ["SYSTEM", "FAMILY", false],
    ["SYSTEM", "PROFESSIONAL", false],
  ];
  it.each(reopenTable)("reabrir fechada por %s pelo lado %s ⇒ permitido=%s", (by, side, allowed) => {
    const r = reopenConversation(closed(by), side);
    expect(r.ok).toBe(allowed);
    if (r.ok) expect(r.state).toMatchObject({ status: "OPEN", closedBy: null });
  });
  it("reabrir uma aberta é inválido; fecho por moderação passa a SYSTEM mesmo se já fechada por um lado", () => {
    for (const side of sides) expect(reopenConversation(open(), side).ok).toBe(false);
    expect(closeBySystem(open())).toMatchObject({ status: "CLOSED", closedBy: "SYSTEM" });
    expect(closeBySystem(closed("PROFESSIONAL"))).toMatchObject({ closedBy: "SYSTEM" });
    expect(reopenConversation(closeBySystem(closed("FAMILY")), "FAMILY").ok).toBe(false);
  });
  it("transições preservam seq e marcadores", () => {
    const s = open({ lastSeq: 9, familyReadSeq: 4, professionalReadSeq: 7 });
    const c = closeConversation(s, "FAMILY");
    expect(c.ok && c.state).toMatchObject({ lastSeq: 9, familyReadSeq: 4, professionalReadSeq: 7 });
  });
});

describe("enviar: bloqueios derivados (BR-MKT-39/47; TC-MKT-57)", () => {
  const table: [ConversationState["status"], Side, boolean, string | null][] = [
    ["OPEN", "FAMILY", true, null],
    ["OPEN", "PROFESSIONAL", true, null],
    ["CLOSED", "FAMILY", true, "CONVERSATION_CLOSED"],
    ["CLOSED", "PROFESSIONAL", true, "CONVERSATION_CLOSED"],
    ["OPEN", "FAMILY", false, "CONVERSATION_CLOSED"],
    ["OPEN", "PROFESSIONAL", false, "PROFESSIONAL_LOCKED"],
    ["CLOSED", "FAMILY", false, "CONVERSATION_CLOSED"],
    ["CLOSED", "PROFESSIONAL", false, "PROFESSIONAL_LOCKED"],
  ];
  it.each(table)("estado %s, lado %s, profissional APPROVED=%s ⇒ %s", (status, side, approved, expected) => {
    expect(sendBlock({ status }, side, approved)).toBe(expected);
    expect(canSend({ status }, approved)).toBe(status === "OPEN" && approved);
  });
});

describe("seq e idempotência (BR-MKT-39; TC-MKT-56)", () => {
  it("nextSeq = lastSeq + 1 e a sequência é contígua; lacunas e repetições são detetadas", () => {
    expect(nextSeq(0)).toBe(1);
    expect(nextSeq(41)).toBe(42);
    expect(hasContiguousSeq([msg(1), msg(2), msg(3)])).toBe(true);
    expect(hasContiguousSeq([msg(3), msg(1), msg(2)])).toBe(true);
    expect(hasContiguousSeq([msg(1), msg(3)])).toBe(false);
    expect(hasContiguousSeq([msg(1), msg(1)])).toBe(false);
    expect(hasContiguousSeq([msg(2)])).toBe(false);
    expect(hasContiguousSeq([])).toBe(true);
  });
  it("findIdempotent: mesmo clientMessageId na mesma conversa devolve a guardada; sem id, outra conversa ou outro id não deduplica", () => {
    const stored = msg(1, "FAMILY", { clientMessageId: "id-1" });
    const list = [stored, msg(2, "PROFESSIONAL")];
    expect(findIdempotent(list, "c1", "id-1")).toBe(stored);
    expect(findIdempotent(list, "c2", "id-1")).toBeNull();
    expect(findIdempotent(list, "c1", "id-2")).toBeNull();
    expect(findIdempotent(list, "c1", null)).toBeNull();
    expect(findIdempotent(list, "c1", undefined)).toBeNull();
  });
  it("mensagem oculta perde o texto", () => {
    expect(visibleBody(msg(1))).toBe("texto 1");
    expect(visibleBody(msg(1, "FAMILY", { hiddenAt: new Date() }))).toBeNull();
  });
});

describe("estado lido por lado (BR-MKT-40)", () => {
  const messages = [msg(1, "FAMILY"), msg(2, "PROFESSIONAL"), msg(3, "PROFESSIONAL"), msg(4, "FAMILY"), msg(5, "PROFESSIONAL")];
  it("unreadCount conta só as mensagens do outro lado depois do marcador", () => {
    expect(unreadCount(open(), "FAMILY", messages)).toBe(3);
    expect(unreadCount(open({ familyReadSeq: 3 }), "FAMILY", messages)).toBe(1);
    expect(unreadCount(open(), "PROFESSIONAL", messages)).toBe(2);
    expect(unreadCount(open({ professionalReadSeq: 4 }), "PROFESSIONAL", messages)).toBe(0);
  });
  it("advanceRead: omissão = última; monótono (nunca recua); só o marcador do chamador muda; fora de 0..lastSeq ⇒ OUT_OF_RANGE", () => {
    const s = open({ lastSeq: 5, familyReadSeq: 3, professionalReadSeq: 2 });
    expect(advanceRead(s, "FAMILY")).toMatchObject({ ok: true, state: { familyReadSeq: 5, professionalReadSeq: 2 } });
    expect(advanceRead(s, "FAMILY", 1)).toMatchObject({ ok: true, state: { familyReadSeq: 3 } });
    expect(advanceRead(s, "PROFESSIONAL", 4)).toMatchObject({ ok: true, state: { familyReadSeq: 3, professionalReadSeq: 4 } });
    expect(advanceRead(s, "FAMILY", 0)).toMatchObject({ ok: true, state: { familyReadSeq: 3 } });
    expect(advanceRead(s, "FAMILY", 6)).toEqual({ ok: false, error: "OUT_OF_RANGE" });
    expect(advanceRead(s, "FAMILY", -1)).toEqual({ ok: false, error: "OUT_OF_RANGE" });
    expect(advanceRead(s, "FAMILY", 1.5)).toEqual({ ok: false, error: "OUT_OF_RANGE" });
    for (const side of ["FAMILY", "PROFESSIONAL"] as const) {
      const r = advanceRead(s, side);
      expect(r.ok && isConsistent(r.state)).toBe(true);
    }
  });
  it("readByOtherSide usa o marcador do outro lado", () => {
    const s = open({ familyReadSeq: 2, professionalReadSeq: 4 });
    expect(readByOtherSide(s, { seq: 4, side: "FAMILY" })).toBe(true);
    expect(readByOtherSide(s, { seq: 5, side: "FAMILY" })).toBe(false);
    expect(readByOtherSide(s, { seq: 2, side: "PROFESSIONAL" })).toBe(true);
    expect(readByOtherSide(s, { seq: 3, side: "PROFESSIONAL" })).toBe(false);
  });
  it("invariantes (espelham os CHECK da 0044)", () => {
    expect(isConsistent(open())).toBe(true);
    expect(isConsistent({ ...open(), closedBy: "FAMILY" })).toBe(false);
    expect(isConsistent({ ...closed("FAMILY"), closedBy: null })).toBe(false);
    expect(isConsistent(open({ familyReadSeq: 6 }))).toBe(false);
  });
  it("aviso ao profissional no máximo 1 cada 30 min", () => {
    expect(shouldNotifyProfessional(null, 1000)).toBe(true);
    expect(shouldNotifyProfessional(0, 29 * 60_000)).toBe(false);
    expect(shouldNotifyProfessional(0, 30 * 60_000)).toBe(true);
  });
});

describe("limites (BR-MKT-42; TC-MKT-61)", () => {
  const now = 10 * DAY_MS;
  const times = (n: number, ageMs: number): number[] => Array.from({ length: n }, (_, i) => now - ageMs + i);
  it("janela deslizante: fronteiras e retryAfter", () => {
    expect(windowDecision(times(29, 1000), now, 30, HOUR_MS)).toEqual({ ok: true });
    const blocked = windowDecision([now - 1000], now, 1, HOUR_MS);
    expect(blocked).toEqual({ ok: false, retryAfterMs: HOUR_MS - 1000 });
    expect(windowDecision([now - HOUR_MS], now, 1, HOUR_MS)).toEqual({ ok: true }); // exatamente na fronteira já saiu
    const two = windowDecision([now - 3000, now - 2000, now - 1000], now, 2, HOUR_MS); // bloqueia até a 2.ª mais recente sair
    expect(two).toEqual({ ok: false, retryAfterMs: HOUR_MS - 2000 });
  });
  const base = { nowMs: now, conversationMessageTimes: [] as number[], senderDayMessageTimes: [] as number[], consecutiveFamilyWithoutReply: 0 };
  it("família: 30/hora, 200/dia, 3 consecutivas sem resposta", () => {
    expect(checkSendLimits({ ...base, side: "FAMILY", conversationMessageTimes: times(29, 60_000) })).toEqual({ ok: true });
    expect(checkSendLimits({ ...base, side: "FAMILY", conversationMessageTimes: times(30, 60_000) })).toMatchObject({ ok: false, kind: "RATE_LIMITED" });
    expect(checkSendLimits({ ...base, side: "FAMILY", senderDayMessageTimes: times(199, 2 * HOUR_MS) })).toEqual({ ok: true });
    expect(checkSendLimits({ ...base, side: "FAMILY", senderDayMessageTimes: times(200, 2 * HOUR_MS) })).toMatchObject({ ok: false, kind: "RATE_LIMITED" });
    expect(checkSendLimits({ ...base, side: "FAMILY", consecutiveFamilyWithoutReply: 2 })).toEqual({ ok: true });
    expect(checkSendLimits({ ...base, side: "FAMILY", consecutiveFamilyWithoutReply: 3 })).toEqual({ ok: false, kind: "LIMIT_EXCEEDED", detail: "Aguarde a resposta do profissional." });
    // a streak (409) tem precedência sobre a taxa
    expect(checkSendLimits({ ...base, side: "FAMILY", consecutiveFamilyWithoutReply: 3, conversationMessageTimes: times(30, 1000) })).toMatchObject({ kind: "LIMIT_EXCEEDED" });
  });
  it("profissional: 60/hora, 300/dia, sem limite de consecutivas", () => {
    expect(checkSendLimits({ ...base, side: "PROFESSIONAL", conversationMessageTimes: times(59, 1000), consecutiveFamilyWithoutReply: 9 })).toEqual({ ok: true });
    expect(checkSendLimits({ ...base, side: "PROFESSIONAL", conversationMessageTimes: times(60, 1000) })).toMatchObject({ kind: "RATE_LIMITED" });
    expect(checkSendLimits({ ...base, side: "PROFESSIONAL", senderDayMessageTimes: times(300, 2 * HOUR_MS) })).toMatchObject({ kind: "RATE_LIMITED" });
    expect(checkSendLimits({ ...base, side: "PROFESSIONAL", senderDayMessageTimes: times(300, 25 * HOUR_MS) })).toEqual({ ok: true });
  });
  it("abrir: 5 conversas novas/24 h e 20 abertas por membro; denúncias 10/dia", () => {
    expect(checkOpenLimits({ nowMs: now, newConversationTimes: times(4, 1000), openForSubject: 19 })).toEqual({ ok: true });
    expect(checkOpenLimits({ nowMs: now, newConversationTimes: times(5, 1000), openForSubject: 0 })).toMatchObject({ kind: "RATE_LIMITED" });
    expect(checkOpenLimits({ nowMs: now, newConversationTimes: [], openForSubject: 20 })).toMatchObject({ kind: "LIMIT_EXCEEDED" });
    expect(checkReportLimit(times(9, 1000), now)).toEqual({ ok: true });
    expect(checkReportLimit(times(10, 1000), now)).toMatchObject({ ok: false, kind: "RATE_LIMITED" });
    expect(CHAT_LIMITS.family.maxConsecutiveWithoutReply).toBe(3);
  });
  it("consecutiveFamilyWithoutReply conta do fim até à resposta do profissional", () => {
    expect(consecutiveFamilyWithoutReply([])).toBe(0);
    expect(consecutiveFamilyWithoutReply([msg(1, "FAMILY"), msg(2, "FAMILY")])).toBe(2);
    expect(consecutiveFamilyWithoutReply([msg(1, "FAMILY"), msg(2, "PROFESSIONAL"), msg(3, "FAMILY")])).toBe(1);
    expect(consecutiveFamilyWithoutReply([msg(3, "FAMILY"), msg(1, "FAMILY"), msg(2, "PROFESSIONAL")])).toBe(1);
    expect(consecutiveFamilyWithoutReply([msg(1, "FAMILY"), msg(2, "PROFESSIONAL")])).toBe(0);
  });
});

describe("denúncia e contexto de moderação (BR-MKT-44; TC-MKT-62/63)", () => {
  it("só se denuncia mensagem do outro lado; uma denúncia por (mensagem, lado)", () => {
    expect(canReport("FAMILY", "PROFESSIONAL")).toBe(true);
    expect(canReport("PROFESSIONAL", "FAMILY")).toBe(true);
    expect(canReport("FAMILY", "FAMILY")).toBe(false);
    const existing = [{ messageId: "m1", reporterSide: "FAMILY" as Side }];
    expect(findExistingReport(existing, "m1", "FAMILY")).toBe(existing[0]);
    expect(findExistingReport(existing, "m1", "PROFESSIONAL")).toBeNull();
    expect(findExistingReport(existing, "m2", "FAMILY")).toBeNull();
  });
  it("decisão: só OPEN → DECIDED, definitiva; efeitos por decisão", () => {
    for (const d of ["DISMISS", "HIDE_MESSAGE", "HIDE_AND_CLOSE"] as const) {
      const first = decideReport({ status: "OPEN", decision: null }, d);
      expect(first).toEqual({ ok: true, state: { status: "DECIDED", decision: d } });
      expect(decideReport({ status: "DECIDED", decision: d }, "DISMISS")).toEqual({ ok: false, error: "INVALID_STATE_TRANSITION" });
    }
    expect(decisionEffects("DISMISS")).toEqual({ hideMessage: false, closeConversation: false });
    expect(decisionEffects("HIDE_MESSAGE")).toEqual({ hideMessage: true, closeConversation: false });
    expect(decisionEffects("HIDE_AND_CLOSE")).toEqual({ hideMessage: true, closeConversation: true });
  });
  const all = [1, 2, 3, 4, 5, 6].map((n) => msg(n, n % 2 ? "FAMILY" : "PROFESSIONAL"));
  it.each([
    [6, [4, 5]],
    [3, [1, 2]],
    [2, [1]],
    [1, []],
  ])("denunciada seq %i ⇒ contexto %j (nunca posteriores nem mais de 2 anteriores)", (seq, expected) => {
    const reported = all.find((m) => m.seq === seq);
    expect(moderationContext(all, reported ?? msg(seq)).map((c) => c.seq)).toEqual(expected);
  });
  it("ignora outras conversas, oculta o texto das ocultas (mantendo o lugar) e só expõe os campos permitidos", () => {
    const list = [msg(1), msg(2, "PROFESSIONAL", { hiddenAt: new Date() }), msg(2, "FAMILY", { conversationId: "outra" }), msg(3)];
    const ctx = moderationContext(list, msg(3));
    expect(ctx.map((c) => [c.seq, c.hidden, c.text])).toEqual([
      [1, false, "texto 1"],
      [2, true, null],
    ]);
    expect(Object.keys(ctx[0] ?? {}).sort()).toEqual(["createdAt", "hidden", "id", "seq", "side", "text"]);
  });
});
