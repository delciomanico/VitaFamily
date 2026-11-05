// Apólices e pedidos de reembolso do titular (UC-INS-01..04, BR-INS-01..05/09/10, AC-INS-01).
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createInsuranceHolderFixtures } from "./fixtures.js";
import { createCreateInsurancePolicyUseCase, createDeleteInsurancePolicyUseCase, createGetInsurancePolicyUseCase, createListInsurancePoliciesUseCase, createUpdateInsurancePolicyUseCase } from "./insurance-policies.js";
import { createListPartnerInsurersUseCase } from "./list-partner-insurers.js";
import { createCreateReimbursementClaimUseCase, createGetReimbursementClaimUseCase, createListReimbursementClaimsUseCase, createMarkReimbursementClaimPaidUseCase } from "./reimbursement-claims.js";

const NOW = new Date("2026-11-05T10:00:00.000Z");
const CTX = { requestId: "req-1" };
const F = "f1";
const M = "m1";
const ACTOR = { userId: "u1", platformAdmin: false };
const INSURER = "11111111-1111-4111-8111-111111111111";
const POLICY_INPUT = { insurerName: "Seg A", policyNumber: "P-1", holderName: "Ana" };

function setup() {
  const fx = createInsuranceHolderFixtures(new FixedClock(NOW));
  fx.insurersRepo.seed({ id: INSURER, name: "Seguradora A", taxId: "500", status: "ACTIVE", createdAt: NOW });
  return fx;
}

async function partnerPolicy(fx: ReturnType<typeof setup>) {
  const view = await createCreateInsurancePolicyUseCase(fx.deps)(ACTOR, F, M, { ...POLICY_INPUT, insurerId: INSURER }, CTX);
  fx.documents.seed("d1");
  return view;
}

describe("apólices (BR-INS-01/02/09)", () => {
  it("cria sem seguradora parceira (texto livre) e com parceira ACTIVE; audita sem dados da apólice", async () => {
    const fx = setup();
    const create = createCreateInsurancePolicyUseCase(fx.deps);

    const free = await create(ACTOR, F, M, { ...POLICY_INPUT, validUntil: "2027-01-31" }, CTX);
    const partner = await create(ACTOR, F, M, { ...POLICY_INPUT, insurerId: INSURER }, CTX);

    expect(free).toMatchObject({ insurerName: "Seg A", validUntil: "2027-01-31", cardDocumentId: null });
    expect(free.insurerId).toBeUndefined();
    expect(partner.insurerId).toBe(INSURER);
    expect(fx.policy.calls.every((c) => c.action === "MANAGE_INSURANCE")).toBe(true);
    expect(fx.audit.events.map((e) => e.action)).toEqual(["INSURANCE_POLICY_CREATE", "INSURANCE_POLICY_CREATE"]);
    expect(JSON.stringify(fx.audit.events)).not.toContain("P-1");
  });

  it.each([
    ["seguradora suspensa", { insurerId: INSURER }, "SUSPENDED"],
    ["seguradora inexistente", { insurerId: "99999999-9999-4999-8999-999999999999" }, "ACTIVE"],
    ["campo obrigatório vazio", { holderName: "  " }, "ACTIVE"],
    ["data inválida", { validUntil: "2027-02-30" }, "ACTIVE"],
    ["foto do cartão antes da apólice existir", { cardDocumentId: "d1" }, "ACTIVE"],
  ] as const)("recusa: %s ⇒ VALIDATION_ERROR", async (_name, extra, status) => {
    const fx = setup();
    fx.insurersRepo.setStatus(INSURER, status);
    await expect(createCreateInsurancePolicyUseCase(fx.deps)(ACTOR, F, M, { ...POLICY_INPUT, ...extra }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fx.policiesRepo.byId.size).toBe(0);
  });

  it("OTHER / dependente com conta: FORBIDDEN em todas as operações (sem acesso, BR-INS-02)", async () => {
    const fx = setup();
    const view = await partnerPolicy(fx);
    fx.policy.relation = "OTHER";
    await expect(createCreateInsurancePolicyUseCase(fx.deps)(ACTOR, F, M, POLICY_INPUT, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createListInsurancePoliciesUseCase(fx.deps)(ACTOR, F, M, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createGetInsurancePolicyUseCase(fx.deps)(ACTOR, F, M, view.id, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createDeleteInsurancePolicyUseCase(fx.deps)(ACTOR, F, M, view.id, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("tutor a ler regista HEALTH_VIEW; o titular não", async () => {
    const fx = setup();
    const view = await partnerPolicy(fx);
    const get = createGetInsurancePolicyUseCase(fx.deps);
    await get(ACTOR, F, M, view.id, CTX);
    expect(fx.audit.events.filter((e) => e.action === "HEALTH_VIEW")).toHaveLength(0);
    fx.policy.relation = "TUTOR_OF";
    await get(ACTOR, F, M, view.id, CTX);
    expect(fx.audit.events.filter((e) => e.action === "HEALTH_VIEW")).toHaveLength(1);
  });

  it("cardDocumentId deriva do documento INSURANCE_POLICY mais recente da apólice", async () => {
    const fx = setup();
    const view = await partnerPolicy(fx);
    fx.documents.seed("old", { resourceType: "INSURANCE_POLICY", resourceId: view.id, createdAt: new Date("2026-11-01T00:00:00Z") });
    fx.documents.seed("new", { resourceType: "INSURANCE_POLICY", resourceId: view.id, createdAt: new Date("2026-11-02T00:00:00Z") });

    expect((await createGetInsurancePolicyUseCase(fx.deps)(ACTOR, F, M, view.id, CTX)).cardDocumentId).toBe("new");
    expect((await createListInsurancePoliciesUseCase(fx.deps)(ACTOR, F, M, CTX)).map((p) => p.cardDocumentId)).toEqual(["new"]);
  });

  it("PATCH: altera campos, limpa insurerId/validUntil com null, valida a nova seguradora e o cardDocumentId", async () => {
    const fx = setup();
    const view = await partnerPolicy(fx);
    fx.documents.seed("card", { resourceType: "INSURANCE_POLICY", resourceId: view.id });
    const update = createUpdateInsurancePolicyUseCase(fx.deps);

    const changed = await update(ACTOR, F, M, view.id, { holderName: "Ana Silva", validUntil: "2027-05-01", cardDocumentId: "card" }, CTX);
    expect(changed).toMatchObject({ holderName: "Ana Silva", validUntil: "2027-05-01", insurerId: INSURER });

    const cleared = await update(ACTOR, F, M, view.id, { insurerId: null, validUntil: null }, CTX);
    expect(cleared.insurerId).toBeUndefined();
    expect(cleared.validUntil).toBeUndefined();

    fx.insurersRepo.setStatus(INSURER, "SUSPENDED");
    await expect(update(ACTOR, F, M, view.id, { insurerId: INSURER }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(update(ACTOR, F, M, view.id, { cardDocumentId: "d1" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(update(ACTOR, F, M, "ghost", { holderName: "X" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("DELETE: apaga a foto (outbox via documents) e a apólice; CONFLICT com pedido SUBMITTED/APPROVED; permite com REJECTED/PAID", async () => {
    const fx = setup();
    const view = await partnerPolicy(fx);
    fx.claimsRepo.seed({ id: "c1", policyId: view.id, insurerId: INSURER, amount: 5, currency: "EUR", status: "APPROVED", documentIds: ["d1"], createdAt: NOW });
    const remove = createDeleteInsurancePolicyUseCase(fx.deps);

    await expect(remove(ACTOR, F, M, view.id, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fx.policiesRepo.byId.has(view.id)).toBe(true);

    fx.claimsRepo.seed({ id: "c1", policyId: view.id, insurerId: INSURER, amount: 5, currency: "EUR", status: "PAID", documentIds: ["d1"], createdAt: NOW });
    await remove(ACTOR, F, M, view.id, CTX);
    expect(fx.policiesRepo.byId.has(view.id)).toBe(false);
    expect(fx.documents.deleted).toEqual([{ resourceType: "INSURANCE_POLICY", resourceId: view.id }]);
    expect(fx.audit.events.at(-1)?.action).toBe("INSURANCE_POLICY_DELETE");
  });
});

describe("pedidos de reembolso (BR-INS-03/04/05/10, AC-INS-01)", () => {
  it("submete sobre apólice de parceira ACTIVE com documentos CLEAN do membro ⇒ SUBMITTED", async () => {
    const fx = setup();
    const view = await partnerPolicy(fx);
    const claim = await createCreateReimbursementClaimUseCase(fx.deps)(ACTOR, F, M, view.id, { amount: 42.5, documentIds: ["d1"] }, CTX);

    expect(claim).toMatchObject({ policyId: view.id, insurerId: INSURER, amount: 42.5, currency: "EUR", status: "SUBMITTED", documentIds: ["d1"] });
    expect(fx.audit.events.at(-1)).toMatchObject({ action: "CLAIM_SUBMIT", metadata: { documentCount: 1 } });
  });

  it("apólice sem insurerId ⇒ VALIDATION_ERROR", async () => {
    const fx = setup();
    const free = await createCreateInsurancePolicyUseCase(fx.deps)(ACTOR, F, M, POLICY_INPUT, CTX);
    fx.documents.seed("d1");
    await expect(createCreateReimbursementClaimUseCase(fx.deps)(ACTOR, F, M, free.id, { amount: 1, documentIds: ["d1"] }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("seguradora SUSPENDED ⇒ CONFLICT; os pedidos existentes mantêm-se (BR-INS-10)", async () => {
    const fx = setup();
    const view = await partnerPolicy(fx);
    const create = createCreateReimbursementClaimUseCase(fx.deps);
    const existing = await create(ACTOR, F, M, view.id, { amount: 1, documentIds: ["d1"] }, CTX);
    fx.insurersRepo.setStatus(INSURER, "SUSPENDED");

    await expect(create(ACTOR, F, M, view.id, { amount: 1, documentIds: ["d1"] }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await createGetReimbursementClaimUseCase(fx.deps)(ACTOR, F, M, view.id, existing.id, CTX)).status).toBe("SUBMITTED");
  });

  it.each([
    ["documento inexistente", () => ({ documentIds: ["ghost"] })],
    ["documento em quarentena (PENDING)", (fx: ReturnType<typeof setup>) => (fx.documents.seed("p", { scanStatus: "PENDING" }), { documentIds: ["p"] })],
    ["documento infetado", (fx: ReturnType<typeof setup>) => (fx.documents.seed("i", { scanStatus: "INFECTED" }), { documentIds: ["i"] })],
    ["documento de outro membro", (fx: ReturnType<typeof setup>) => (fx.documents.seed("o", { memberId: "m2" }), { documentIds: ["o"] })],
    ["documento de outra família", (fx: ReturnType<typeof setup>) => (fx.documents.seed("x", { familyId: "f2" }), { documentIds: ["x"] })],
  ])("recusa: %s ⇒ VALIDATION_ERROR", async (_name, build) => {
    const fx = setup();
    const view = await partnerPolicy(fx);
    const extra = build(fx);
    await expect(createCreateReimbursementClaimUseCase(fx.deps)(ACTOR, F, M, view.id, { amount: 1, ...extra }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fx.claimsRepo.byId.size).toBe(0);
  });

  it("apólice de outro membro/inexistente ⇒ NOT_FOUND; OTHER ⇒ FORBIDDEN", async () => {
    const fx = setup();
    const view = await partnerPolicy(fx);
    const create = createCreateReimbursementClaimUseCase(fx.deps);
    await expect(create(ACTOR, F, "m2", view.id, { amount: 1, documentIds: ["d1"] }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    fx.policy.relation = "OTHER";
    await expect(create(ACTOR, F, M, view.id, { amount: 1, documentIds: ["d1"] }, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createListReimbursementClaimsUseCase(fx.deps)(ACTOR, F, M, view.id, CTX)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("PAID: só APPROVED (titular/tutor); SUBMITTED/REJECTED/PAID ⇒ CONFLICT; audita", async () => {
    const fx = setup();
    const view = await partnerPolicy(fx);
    const pay = createMarkReimbursementClaimPaidUseCase(fx.deps);
    for (const [id, status] of [["c-sub", "SUBMITTED"], ["c-rej", "REJECTED"], ["c-paid", "PAID"]] as const) {
      fx.claimsRepo.seed({ id, policyId: view.id, insurerId: INSURER, amount: 1, currency: "EUR", status, ...(status === "REJECTED" ? { decisionNote: "n" } : {}), documentIds: ["d1"], createdAt: NOW });
      await expect(pay(ACTOR, F, M, view.id, id, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    }
    fx.claimsRepo.seed({ id: "c-ok", policyId: view.id, insurerId: INSURER, amount: 1, currency: "EUR", status: "APPROVED", documentIds: ["d1"], createdAt: NOW });
    expect((await pay(ACTOR, F, M, view.id, "c-ok", CTX)).status).toBe("PAID");
    expect(fx.audit.events.at(-1)?.action).toBe("CLAIM_PAID");
    await expect(pay(ACTOR, F, M, view.id, "ghost", CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("GET /families/{id}/insurers (BR-INS-09)", () => {
  it("membro vê só id e nome das ACTIVE; não-membro (ou Platform Admin) ⇒ NOT_FOUND", async () => {
    const fx = setup();
    fx.insurersRepo.seed({ id: "22222222-2222-4222-8222-222222222222", name: "Suspensa", taxId: "501", status: "SUSPENDED", createdAt: NOW });
    fx.membership.members.add(`${F}:u1`);
    const list = createListPartnerInsurersUseCase(fx.deps);

    const result = await list(ACTOR, F);
    expect(result).toEqual([{ id: INSURER, name: "Seguradora A" }]);
    await expect(list({ userId: "u2", platformAdmin: false }, F)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
