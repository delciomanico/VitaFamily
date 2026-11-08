// Pedidos no portal da seguradora (UC-INS-06/07, BR-INS-04/05/07, authorization.md §8, AC-INS-02).
import { describe, expect, it } from "vitest";
import { FixedClock } from "../../../platform/clock/index.js";
import { createInsuranceHolderFixtures } from "./fixtures.js";
import { createDecideInsuranceClaimUseCase, createGetInsuranceClaimUseCase, createListInsuranceClaimsUseCase } from "./portal-claims.js";

const NOW = new Date("2026-11-05T10:00:00.000Z");
const CTX = { requestId: "req-1" };
const INS_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const INS_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const ADMIN_A = { insuranceAccountId: "adm-a", insurerId: INS_A, role: "INSURANCE_ADMIN" as const };
const AGENT_A = { insuranceAccountId: "agt-a", insurerId: INS_A, role: "INSURANCE_AGENT" as const };
const AGENT_B = { insuranceAccountId: "agt-b", insurerId: INS_B, role: "INSURANCE_AGENT" as const };

function setup() {
  const fx = createInsuranceHolderFixtures(new FixedClock(NOW));
  fx.policiesRepo.seed({ id: "p1", familyId: "f1", memberId: "m1", insurerId: INS_A, insurerName: "A", policyNumber: "P-1", holderName: "Ana", createdAt: NOW });
  fx.policiesRepo.seed({ id: "p2", familyId: "f2", memberId: "m2", insurerId: INS_B, insurerName: "B", policyNumber: "P-2", holderName: "Bruno", createdAt: NOW });
  fx.claimsRepo.seed({ id: "c1", policyId: "p1", insurerId: INS_A, amount: 10, currency: "EUR", status: "SUBMITTED", documentIds: ["d1", "d2"], createdAt: NOW });
  fx.claimsRepo.seed({ id: "c2", policyId: "p2", insurerId: INS_B, amount: 20, currency: "EUR", status: "SUBMITTED", documentIds: ["d3"], createdAt: NOW });
  return fx;
}

describe("portal da seguradora: leitura (minimização, BR-INS-04)", () => {
  it("lista só os pedidos da própria seguradora, com o mínimo (sem família/membro/apólice interna)", async () => {
    const fx = setup();
    const list = createListInsuranceClaimsUseCase(fx.portalDeps);

    const a = await list(AGENT_A, {});
    expect(a).toEqual([{ id: "c1", status: "SUBMITTED", amount: 10, currency: "EUR", policyHolderName: "Ana", policyNumber: "P-1", decisionNote: null, documentIds: ["d1", "d2"], receipts: [] }]);
    expect((await list(AGENT_B, {})).map((c) => c.id)).toEqual(["c2"]);
    expect(Object.keys(a[0] ?? {}).sort()).toEqual(["amount", "currency", "decisionNote", "documentIds", "id", "policyHolderName", "policyNumber", "receipts", "status"]);
  });

  it("filtro status; valor inválido ⇒ VALIDATION_ERROR", async () => {
    const fx = setup();
    const list = createListInsuranceClaimsUseCase(fx.portalDeps);
    expect(await list(ADMIN_A, { status: "APPROVED" })).toEqual([]);
    expect((await list(ADMIN_A, { status: "SUBMITTED" })).map((c) => c.id)).toEqual(["c1"]);
    await expect(list(ADMIN_A, { status: "XPTO" })).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("pedido de outra seguradora ⇒ NOT_FOUND (sem enumeração) em get e decide", async () => {
    const fx = setup();
    await expect(createGetInsuranceClaimUseCase(fx.portalDeps)(AGENT_A, "c2")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createDecideInsuranceClaimUseCase(fx.portalDeps)(AGENT_A, "c2", { decision: "APPROVE" }, CTX)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fx.claimsRepo.byId.get("c2")?.status).toBe("SUBMITTED");
  });
});

describe("portal da seguradora: decidir (BR-INS-05/07)", () => {
  it.each([ADMIN_A, AGENT_A])("$role aprova com nota opcional (mesmas permissões) e audita como INSURANCE_ACCOUNT", async (actor) => {
    const fx = setup();
    const view = await createDecideInsuranceClaimUseCase(fx.portalDeps)(actor, "c1", { decision: "APPROVE" }, CTX);

    expect(view).toMatchObject({ id: "c1", status: "APPROVED", decisionNote: null });
    expect(fx.audit.events.at(-1)).toMatchObject({
      actorType: "INSURANCE_ACCOUNT",
      actorInsuranceAccountId: actor.insuranceAccountId,
      action: "CLAIM_DECIDE",
      familyId: "f1",
      metadata: { status: "APPROVED" },
    });
    expect(fx.audit.events.at(-1)?.actorUserId).toBeUndefined();
  });

  it("rejeita com motivo; sem motivo ⇒ VALIDATION_ERROR e nada muda", async () => {
    const fx = setup();
    const decide = createDecideInsuranceClaimUseCase(fx.portalDeps);
    await expect(decide(AGENT_A, "c1", { decision: "REJECT" }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await expect(decide(AGENT_A, "c1", { decision: "REJECT", note: "  " }, CTX)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(fx.claimsRepo.byId.get("c1")?.status).toBe("SUBMITTED");

    expect(await decide(AGENT_A, "c1", { decision: "REJECT", note: "Fora da cobertura" }, CTX)).toMatchObject({ status: "REJECTED", decisionNote: "Fora da cobertura" });
  });

  it("já decidido ⇒ CONFLICT (nenhuma segunda decisão)", async () => {
    const fx = setup();
    const decide = createDecideInsuranceClaimUseCase(fx.portalDeps);
    await decide(AGENT_A, "c1", { decision: "APPROVE" }, CTX);
    await expect(decide(ADMIN_A, "c1", { decision: "REJECT", note: "x" }, CTX)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(fx.claimsRepo.byId.get("c1")?.status).toBe("APPROVED");
  });
});
