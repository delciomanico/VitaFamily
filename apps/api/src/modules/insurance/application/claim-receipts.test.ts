// AC-CLN-27 / TC-CLN-19 (BR-CLN-36, emenda a BR-INS-04): recibos anexados ao pedido de reembolso — opt-in por recibo, validações
// (visível, ISSUED, mesma moeda, sem outro pedido ativo), 1–10 itens no total, resumo mínimo para a seguradora, BR-SEG-21 intacto.
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { parseClaimInput } from "../domain/reimbursement-claim.js";
import { createInsuranceHolderFixtures } from "./fixtures.js";
import { createCreateInsurancePolicyUseCase } from "./insurance-policies.js";
import { createGetInsuranceClaimUseCase, createListInsuranceClaimsUseCase } from "./portal-claims.js";
import { createCreateReimbursementClaimUseCase, createGetReimbursementClaimUseCase } from "./reimbursement-claims.js";

const NOW = new Date("2026-11-08T10:00:00.000Z");
const CTX = { requestId: "req-1" };
const ACTOR = { userId: "u1", platformAdmin: false };
const INSURER = "11111111-1111-4111-8111-111111111111";

async function setup() {
  const fx = createInsuranceHolderFixtures(new FixedClock(NOW));
  fx.insurersRepo.seed({ id: INSURER, name: "Seguradora A", taxId: "500", status: "ACTIVE", createdAt: NOW });
  const policy = await createCreateInsurancePolicyUseCase(fx.deps)(ACTOR, "f1", "m1", { insurerName: "Seg", policyNumber: "P-1", holderName: "Ana", insurerId: INSURER }, CTX);
  fx.documents.seed("d1");
  const receipt = (id: string, patch: Partial<{ status: "ISSUED" | "VOIDED"; currency: string; visible: boolean }> = {}) =>
    fx.receipts.receipts.set(id, { id, number: 7, status: "ISSUED", totalMinor: 1500, currency: "EUR", visible: true, ...patch });
  receipt("r1");
  return { fx, policyId: policy.id, receipt, create: createCreateReimbursementClaimUseCase(fx.deps) };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("parseClaimInput com receiptIds (BR-INS-04 + BR-CLN-36)", () => {
  it.each([
    [{ amount: 1, receiptIds: ["r1"] }, 0, 1],
    [{ amount: 1, documentIds: ["d1"], receiptIds: ["r1", "r2"] }, 1, 2],
    [{ amount: 1, documentIds: Array.from({ length: 5 }, (_, i) => `d${String(i)}`), receiptIds: Array.from({ length: 5 }, (_, i) => `r${String(i)}`) }, 5, 5],
  ])("aceita %j", (input, docs, receipts) => {
    const parsed = parseClaimInput(input);
    expect([parsed.documentIds.length, parsed.receiptIds.length]).toEqual([docs, receipts]);
  });

  it.each([
    [{ amount: 1 }, "0 itens"],
    [{ amount: 1, documentIds: [], receiptIds: [] }, "0 itens"],
    [{ amount: 1, documentIds: Array.from({ length: 6 }, (_, i) => `d${String(i)}`), receiptIds: Array.from({ length: 5 }, (_, i) => `r${String(i)}`) }, "11 itens"],
    [{ amount: 1, receiptIds: ["r1", "r1"] }, "recibo repetido"],
    [{ amount: 1, receiptIds: "r1" }, "não lista"],
  ])("recusa %j (%s)", (input) => {
    expect(() => parseClaimInput(input)).toThrow();
  });
});

describe("criar pedido com recibos (BR-CLN-36)", () => {
  it("só recibos: pedido criado, receiptIds guardados e referências devolvidas; auditoria com receiptCount e sem Document/despesa novos", async () => {
    const { fx, policyId, create } = await setup();
    const claim = await create(ACTOR, "f1", "m1", policyId, { amount: 15, currency: "EUR", receiptIds: ["r1"] }, CTX);
    expect(claim.receiptIds).toEqual(["r1"]);
    expect(claim.documentIds).toEqual([]);
    expect(claim.receipts).toEqual([{ receiptId: "r1", number: 7, status: "ISSUED", totalMinor: 1500, currency: "EUR" }]);
    expect(fx.audit.events.find((e) => e.action === "CLAIM_SUBMIT")?.metadata).toEqual({ documentCount: 0, receiptCount: 1 });
    const read = await createGetReimbursementClaimUseCase(fx.deps)(ACTOR, "f1", "m1", policyId, claim.id, CTX);
    expect(read.receipts?.map((r) => r.receiptId)).toEqual(["r1"]);
  });

  it.each([
    ["recibo não visível ao membro (ou de outro)", { r1: { visible: false } }, "NOT_FOUND"],
    ["recibo anulado", { r1: { status: "VOIDED" as const } }, "CONFLICT"],
    ["moeda diferente da do pedido", { r1: { currency: "AOA" } }, "VALIDATION_ERROR"],
  ])("%s", async (_name, patch, code) => {
    const { policyId, receipt, create } = await setup();
    receipt("r1", patch.r1);
    expect(await codeOf(create(ACTOR, "f1", "m1", policyId, { amount: 15, currency: "EUR", receiptIds: ["r1"] }, CTX))).toBe(code);
  });

  it("recibo já anexado a outro pedido SUBMITTED => CONFLICT; REJECTED liberta-o", async () => {
    const { fx, policyId, create } = await setup();
    const first = await create(ACTOR, "f1", "m1", policyId, { amount: 15, currency: "EUR", receiptIds: ["r1"] }, CTX);
    expect(await codeOf(create(ACTOR, "f1", "m1", policyId, { amount: 15, currency: "EUR", receiptIds: ["r1"] }, CTX))).toBe("CONFLICT");
    fx.claimsRepo.byId.set(first.id, { ...first, status: "REJECTED" });
    expect((await create(ACTOR, "f1", "m1", policyId, { amount: 15, currency: "EUR", receiptIds: ["r1"] }, CTX)).receiptIds).toEqual(["r1"]);
  });
});

describe("seguradora vê o resumo mínimo (BR-CLN-36)", () => {
  it("InsuranceClaimView.receipts: número, data, clínica, linhas, total, moeda e estado; sem ids nem método; anulado depois aparece VOIDED", async () => {
    const { fx, policyId, receipt, create } = await setup();
    const claim = await create(ACTOR, "f1", "m1", policyId, { amount: 15, currency: "EUR", documentIds: ["d1"], receiptIds: ["r1"] }, CTX);
    const actor = { insuranceAccountId: "i1", insurerId: INSURER, role: "INSURANCE_AGENT" as const };
    const view = await createGetInsuranceClaimUseCase(fx.portalDeps)(actor, claim.id);
    expect(view.receipts).toEqual([{ number: 7, issuedAt: "2026-01-01T00:00:00.000Z", clinicName: "Clínica Sol", lines: [{ description: "Consulta", amountMinor: 1500 }], totalMinor: 1500, currency: "EUR", status: "ISSUED" }]);
    expect(JSON.stringify(view)).not.toContain("r1");
    receipt("r1", { status: "VOIDED" });
    expect((await createListInsuranceClaimsUseCase(fx.portalDeps)(actor, {}))[0]?.receipts[0]?.status).toBe("VOIDED");
  });
});
