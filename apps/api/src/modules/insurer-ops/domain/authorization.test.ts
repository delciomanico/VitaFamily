// BR-AUT-04/08/12/13: ações permitidas, validação do pedido (C2: sem campos clínicos) e ficheiros dos anexos.
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { ATTACHMENT_KINDS, allowedActions, appealOpenUntil, isPartial, parseAppealInput, parseCancelInput, parseCreateAuthorizationInput, parseRespondInput, parseAttachmentKind } from "./authorization.js";
import { detectAttachmentMime } from "./attachment-file.js";

const TODAY = "2026-06-01";
const VALID = { insurerId: "11111111-1111-4111-8111-111111111111", cardNumber: "ab-1", serviceCode: "CONS", requestedAmount: 100.5, expectedOn: "2026-06-02", justification: "Consulta de seguimento pedida pelo médico" };
const field = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as ValidationError).fields?.[0]?.field;
  }
  return undefined;
};

describe("allowedActions (TC-AUT-09)", () => {
  const NOW = new Date("2026-06-10T12:00:00Z");
  const base = { decidedAt: null, hasLiveAppeal: false };
  it.each([
    ["SUBMITTED", ["CANCEL", "ATTACH"]],
    ["IN_REVIEW", ["CANCEL", "ATTACH"]],
    ["INFO_REQUESTED", ["RESPOND", "CANCEL", "ATTACH"]],
    ["APPROVED", []],
    ["CANCELLED", []],
  ] as const)("%s ⇒ %j", (status, expected) => {
    expect(allowedActions({ ...base, status }, NOW, 15)).toEqual(expected);
  });

  it("REJECTED: APPEAL só dentro do prazo e sem recurso vivo", () => {
    const rejected = { status: "REJECTED", decidedAt: new Date("2026-06-01T12:00:00Z"), hasLiveAppeal: false } as const;
    expect(allowedActions(rejected, NOW, 15)).toEqual(["APPEAL"]);
    expect(allowedActions(rejected, NOW, 5)).toEqual([]);
    expect(allowedActions({ ...rejected, hasLiveAppeal: true }, NOW, 15)).toEqual([]);
    expect(appealOpenUntil(rejected, 20)?.toISOString()).toBe("2026-06-21T12:00:00.000Z");
    expect(appealOpenUntil({ status: "IN_REVIEW", decidedAt: null }, 20)).toBeNull();
  });

  it("aprovada em parte é derivado (BR-AUT-04)", () => {
    expect(isPartial({ status: "APPROVED", authorizedAmount: 50, requestedAmount: 100 })).toBe(true);
    expect(isPartial({ status: "APPROVED", authorizedAmount: 100, requestedAmount: 100 })).toBe(false);
    expect(isPartial({ status: "IN_REVIEW", authorizedAmount: null, requestedAmount: 100 })).toBe(false);
  });
});

describe("parseCreateAuthorizationInput (TC-AUT-06, BR-AUT-12)", () => {
  it("aceita o pedido válido", () => {
    expect(parseCreateAuthorizationInput(VALID, TODAY)).toMatchObject({ requestedAmount: 100.5, expectedOn: "2026-06-02", guideType: null, processId: null });
  });

  it.each([
    ["justificação vazia", { justification: "  " }, "justification"],
    ["justificação com 501 caracteres", { justification: "x".repeat(501) }, "justification"],
    ["valor zero", { requestedAmount: 0 }, "requestedAmount"],
    ["valor negativo", { requestedAmount: -1 }, "requestedAmount"],
    ["acima do máximo", { requestedAmount: 1e13 }, "requestedAmount"],
    ["3 casas decimais", { requestedAmount: 10.123 }, "requestedAmount"],
    ["data passada", { expectedOn: "2026-05-31" }, "expectedOn"],
    ["data inválida", { expectedOn: "2026-02-30" }, "expectedOn"],
    ["campo clínico diagnosis", { diagnosis: "x" }, "diagnosis"],
    ["campo clínico icd", { icd: "J00" }, "icd"],
    ["dois identificadores", { qrToken: "abc" }, "cardNumber"],
    ["sem serviceCode", { serviceCode: undefined }, "serviceCode"],
    ["guideType inválido", { guideType: "consulta" }, "guideType"],
    ["processId inválido", { processId: "x" }, "processId"],
  ])("rejeita: %s", (_name, patch, expectedField) => {
    expect(field(() => parseCreateAuthorizationInput({ ...VALID, ...patch }, TODAY))).toBe(expectedField);
  });

  it("recurso, resposta e cancelamento também rejeitam campos desconhecidos", () => {
    expect(field(() => parseAppealInput({ justification: "novo documento", diagnosis: "x" }, TODAY))).toBe("diagnosis");
    expect(field(() => parseRespondInput({ message: "ok", icd: "x" }))).toBe("icd");
    expect(field(() => parseCancelInput({ note: "x", reason: "y" }))).toBe("reason");
    expect(parseCancelInput(undefined)).toEqual({ note: null });
    expect(field(() => parseCancelInput({ note: "x".repeat(201) }))).toBe("note");
  });
});

describe("anexos administrativos (BR-AUT-13, TC-AUT-17)", () => {
  it("lista fechada sem tipos clínicos", () => {
    expect([...ATTACHMENT_KINDS]).toEqual(["QUOTE", "INSURER_FORM", "ID_COPY", "OTHER_ADMIN"]);
    expect(ATTACHMENT_KINDS.join(" ")).not.toMatch(/REPORT|PRESCRIPTION|EXAM|LAUDO|CLINICAL/);
    expect(field(() => parseAttachmentKind("CLINICAL_REPORT"))).toBe("kind");
  });

  it("tipo verificado pelo conteúdo (PDF, JPEG, PNG), nunca pela extensão", () => {
    expect(detectAttachmentMime(Buffer.from("%PDF-1.7 x"))).toBe("application/pdf");
    expect(detectAttachmentMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe("image/jpeg");
    expect(detectAttachmentMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("image/png");
    expect(detectAttachmentMime(Buffer.from("MZ\x90\x00"))).toBeNull();
    expect(detectAttachmentMime(Buffer.from("PK\x03\x04"))).toBeNull();
  });
});
