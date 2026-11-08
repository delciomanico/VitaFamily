import { describe, expect, it } from "vitest";
import { MAX_AMOUNT_MINOR, assertCanVoid, buildReceiptLines, formatReceiptNumber, parseVoidReason, type CatalogService } from "./receipt.js";
import { parseIssueReceiptInput } from "./receipt-input.js";

const SERVICES = new Map<string, CatalogService>([
  ["s1", { id: "s1", name: "Consulta de Cardiologia", priceMinor: 1_500_000 }],
  ["s2", { id: "s2", name: "Consulta sem preço", priceMinor: null }],
]);

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("formatReceiptNumber (BR-CLN-32)", () => {
  it.each([
    [1, "R-000001"],
    [123, "R-000123"],
    [999_999, "R-999999"],
    [1_234_567, "R-1234567"],
  ])("%i -> %s", (n, expected) => {
    expect(formatReceiptNumber(n)).toBe(expected);
  });
});

describe("buildReceiptLines (BR-CLN-31/34)", () => {
  it("linha de catálogo usa nome e preço; amountMinor ajusta; soma no servidor", () => {
    const result = buildReceiptLines([{ serviceTypeId: "s1" }, { serviceTypeId: "s1", amountMinor: 1000 }, { description: "Material", amountMinor: 500 }], SERVICES);
    expect(result.lines.map((l) => [l.position, l.description, l.amountMinor, l.serviceTypeId])).toEqual([
      [1, "Consulta de Cardiologia", 1_500_000, "s1"],
      [2, "Consulta de Cardiologia", 1000, "s1"],
      [3, "Material", 500, null],
    ]);
    expect(result.totalMinor).toBe(1_501_500);
  });

  it("serviço sem preço sem ajuste => VALIDATION_ERROR; com ajuste => aceita", () => {
    expect(codeOf(() => buildReceiptLines([{ serviceTypeId: "s2" }], SERVICES))).toBe("VALIDATION_ERROR");
    expect(buildReceiptLines([{ serviceTypeId: "s2", amountMinor: 2000 }], SERVICES).totalMinor).toBe(2000);
  });

  it.each([
    [[{ description: "Grátis", amountMinor: 0 }], "total 0"],
    [[{ description: "Enorme", amountMinor: MAX_AMOUNT_MINOR }, { description: "Mais", amountMinor: 1 }], "total acima de 10^11"],
    [[{ serviceTypeId: "desconhecido" }], "serviço desconhecido"],
    [[{ description: "Sem valor" }], "linha livre sem valor"],
  ])("recusa %j (%s)", (lines) => {
    expect(codeOf(() => buildReceiptLines(lines, SERVICES))).toBe("VALIDATION_ERROR");
  });
});

describe("estado do recibo (BR-CLN-33)", () => {
  it("só ISSUED se anula; VOIDED => INVALID_STATE_TRANSITION", () => {
    expect(() => { assertCanVoid("ISSUED"); }).not.toThrow();
    expect(codeOf(() => { assertCanVoid("VOIDED"); })).toBe("INVALID_STATE_TRANSITION");
  });

  it.each([
    ["ab", false],
    ["abc", true],
    ["  x ", false],
    ["x".repeat(200), true],
    ["x".repeat(201), false],
    [undefined, false],
  ])("motivo %j válido=%s", (reason, valid) => {
    if (valid) expect(parseVoidReason(reason)).toBe((reason ?? "").trim());
    else expect(codeOf(() => parseVoidReason(reason))).toBe("VALIDATION_ERROR");
  });
});

describe("parseIssueReceiptInput", () => {
  const base = { bookingKind: "APPOINTMENT", bookingId: "b1", paymentMethod: "CASH" };

  it("aceita o mínimo (um toque) e normaliza nota", () => {
    expect(parseIssueReceiptInput(base)).toEqual(base);
    expect(parseIssueReceiptInput({ ...base, note: "  olá ", lines: [{ serviceTypeId: "s1" }, { description: "X", amountMinor: 5 }] })).toEqual({
      ...base,
      note: "olá",
      lines: [{ serviceTypeId: "s1" }, { description: "X", amountMinor: 5 }],
    });
  });

  it.each([
    [{ ...base, bookingKind: "OTHER" }, "tipo"],
    [{ ...base, paymentMethod: "BITCOIN" }, "método"],
    [{ ...base, bookingId: "" }, "bookingId"],
    [{ ...base, note: "x".repeat(201) }, "nota longa"],
    [{ ...base, lines: [] }, "0 linhas"],
    [{ ...base, lines: Array.from({ length: 21 }, () => ({ description: "x", amountMinor: 1 })) }, "21 linhas"],
    [{ ...base, lines: [{ serviceTypeId: "s1", description: "x" }] }, "catálogo com descrição"],
    [{ ...base, lines: [{ description: "x" }] }, "livre sem valor"],
    [{ ...base, lines: [{ description: "x", amountMinor: -1 }] }, "valor negativo"],
    [{ ...base, lines: [{ description: "x", amountMinor: 1.5 }] }, "valor não inteiro"],
    [{ ...base, lines: [{ description: "x".repeat(121), amountMinor: 1 }] }, "descrição longa"],
    ["texto", "não objeto"],
  ])("recusa %j (%s)", (body) => {
    expect(codeOf(() => parseIssueReceiptInput(body))).toBe("VALIDATION_ERROR");
  });
});
