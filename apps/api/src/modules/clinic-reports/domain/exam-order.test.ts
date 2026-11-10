// BR-CLN-51/52/55 (regras puras): validação de itens, visibilidade `booked_here`, cancelamento, elegibilidade da declaração.
import { describe, expect, it } from "vitest";
import { assertAttendanceEligible, assertBookingAllowsOrders, assertCancellable, clinicVisibleStatus, parseExamOrderItems, parseExamOrdersBody, truncateChars, type ExamOrderStatus } from "./exam-order.js";

const SERVICE = "6f9619ff-8b86-4011-b42d-00c04fc964ff";
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
};

describe("parseExamOrderItems (BR-CLN-51)", () => {
  it("normaliza nome/nota (aparados) e aplica urgent=false por omissão", () => {
    expect(parseExamOrderItems([{ name: "  Hemograma  ", note: " Jejum de 8 h ", urgent: true }, { serviceTypeId: SERVICE }], "items")).toEqual([
      { name: "Hemograma", serviceTypeId: null, note: "Jejum de 8 h", urgent: true },
      { name: null, serviceTypeId: SERVICE, note: null, urgent: false },
    ]);
  });

  it.each([
    ["vazio", []],
    ["6 itens", Array.from({ length: 6 }, () => ({ name: "x" }))],
    ["não é array", { name: "x" }],
    ["nome e serviço ambos", [{ name: "x", serviceTypeId: SERVICE }]],
    ["nem nome nem serviço", [{ note: "x" }]],
    ["nome só com espaços", [{ name: "   " }]],
    ["nome com 81 caracteres", [{ name: "a".repeat(81) }]],
    ["nota com 201 caracteres", [{ name: "x", note: "a".repeat(201) }]],
    ["controlo no nome", [{ name: "a\u0007b" }]],
    ["quebra de linha na nota", [{ name: "x", note: "a\nb" }]],
    ["C1 na nota", [{ name: "x", note: "a\u0085b" }]],
    ["serviço inválido", [{ serviceTypeId: "nope" }]],
    ["urgent não booleano", [{ name: "x", urgent: "sim" }]],
    ["campo desconhecido", [{ name: "x", price: 1 }]],
    ["item não objeto", ["x"]],
  ])("rejeita %s com VALIDATION_ERROR", (_label, input) => {
    expect(codeOf(() => parseExamOrderItems(input, "items"))).toBe("VALIDATION_ERROR");
  });

  it("aceita exatamente 80 caracteres no nome e 200 na nota (pontos de código, não unidades UTF-16)", () => {
    expect(() => parseExamOrderItems([{ name: "😀".repeat(80), note: "ç".repeat(200) }], "items")).not.toThrow();
  });

  it("o corpo do POST só aceita `items`", () => {
    expect(parseExamOrdersBody({ items: [{ name: "x" }] })).toHaveLength(1);
    expect(codeOf(() => parseExamOrdersBody({ items: [{ name: "x" }], extra: 1 }))).toBe("VALIDATION_ERROR");
    expect(codeOf(() => parseExamOrdersBody(null))).toBe("VALIDATION_ERROR");
  });

  it("os erros não repetem o texto do exame (BR-HLT-05)", () => {
    try {
      parseExamOrderItems([{ name: "Teste de VIH confidencial", note: "x".repeat(300) }], "items");
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain("VIH");
    }
  });

  it("truncateChars respeita pontos de código", () => {
    expect(truncateChars("😀😀😀", 2)).toBe("😀😀");
  });
});

describe("clinicVisibleStatus / assertCancellable (BR-CLN-52)", () => {
  it.each<[ExamOrderStatus, boolean, ExamOrderStatus]>([
    ["ORDERED", false, "ORDERED"],
    ["SCHEDULED", false, "ORDERED"],
    ["FULFILLED", false, "ORDERED"],
    ["SCHEDULED", true, "SCHEDULED"],
    ["FULFILLED", true, "FULFILLED"],
    ["CANCELLED", false, "CANCELLED"],
  ])("%s com bookedHere=%s é visto como %s", (status, bookedHere, visible) => {
    expect(clinicVisibleStatus({ status, bookedHere })).toBe(visible);
  });

  it("cancela ORDERED/SCHEDULED visíveis; FULFILLED visível => INVALID_STATE_TRANSITION; CANCELLED => idempotente", () => {
    expect(assertCancellable({ status: "ORDERED", bookedHere: false })).toBe("CANCEL");
    expect(assertCancellable({ status: "SCHEDULED", bookedHere: true })).toBe("CANCEL");
    // cumprido noutra clínica: a clínica vê ORDERED e pode cancelar (o Examination não é tocado)
    expect(assertCancellable({ status: "FULFILLED", bookedHere: false })).toBe("CANCEL");
    expect(codeOf(() => assertCancellable({ status: "FULFILLED", bookedHere: true }))).toBe("INVALID_STATE_TRANSITION");
    expect(assertCancellable({ status: "CANCELLED", bookedHere: false })).toBe("ALREADY_CANCELLED");
  });
});

describe("estados da marcação (BR-CLN-51/55)", () => {
  it.each([
    ["SCHEDULED", true],
    ["COMPLETED", true],
    ["CANCELLED", false],
    ["NO_SHOW", false],
    ["REQUESTED", false],
    ["REJECTED", false],
  ])("pedido de exame em %s: permitido=%s", (status, allowed) => {
    expect(codeOf(() => {
      assertBookingAllowsOrders(status);
    })).toBe(allowed ? undefined : "INVALID_STATE_TRANSITION");
  });

  it.each<[string, Date | undefined, boolean]>([
    ["COMPLETED", undefined, true],
    ["SCHEDULED", new Date(), true],
    ["SCHEDULED", undefined, false],
    ["NO_SHOW", new Date(), false],
    ["CANCELLED", new Date(), false],
    ["REQUESTED", undefined, false],
    ["REJECTED", undefined, false],
  ])("declaração em %s (chegada=%s): elegível=%s", (status, arrivedAt, eligible) => {
    expect(codeOf(() => {
      assertAttendanceEligible(status, arrivedAt);
    })).toBe(eligible ? undefined : "INVALID_STATE_TRANSITION");
  });
});
