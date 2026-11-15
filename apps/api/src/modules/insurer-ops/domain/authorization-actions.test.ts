// TC-AZ-DEC-01 / TC-DEC-08/09/10 (authorization.md §8.2d, BR-AUT-18/21/22): a matriz fina papel × ação × pedido, como DADOS.
import { describe, expect, it } from "vitest";
import { acoesPermitidas, checkAction, type ActionSubject, type DecisionRole, type InsurerAuthorizationAction } from "./authorization-actions.js";

const ME = "acc-me";
const OTHER = "acc-other";
const base: ActionSubject = { status: "IN_REVIEW", isAppeal: false, assignedToAccountId: null, decidedByKind: null, decidedByAccountId: null, originDeciderAccountId: null, priorRejecterAccountId: null, appealWindowOpen: false, hasLiveAppeal: false };
const subject = (over: Partial<ActionSubject> = {}): ActionSubject => ({ ...base, ...over });
const check = (action: InsurerAuthorizationAction, role: DecisionRole, s: ActionSubject, accountId = ME) => checkAction(action, { role, accountId }, s);
const outcome = (c: ReturnType<typeof checkAction>) => (c.ok ? "OK" : c.error);

describe("papéis sem decisão: só leem (403 em qualquer ação)", () => {
  const actions: InsurerAuthorizationAction[] = ["ASSIGN", "UNASSIGN", "APPROVE", "REJECT", "REQUEST_INFO", "CANCEL", "REOPEN", "DOWNLOAD_ATTACHMENT"];
  it.each((["INSURANCE_ADMIN", "CLAIMS_MANAGER", "FINANCE_MANAGER", "BENEFICIARY_MANAGER", "INSURANCE_AGENT"] as const).flatMap((role) => actions.map((action) => [role, action] as const)))("%s / %s ⇒ FORBIDDEN", (role, action) => {
    expect(outcome(check(action, role, subject()))).toBe("FORBIDDEN");
    expect(acoesPermitidas({ role, accountId: ME }, subject())).toEqual([]);
  });
});

describe("decidir (approve/reject/request-info)", () => {
  it.each(["APPROVE", "REJECT", "REQUEST_INFO"] as const)("%s: analista em pedido normal livre ou seu ⇒ OK; atribuído a outro ⇒ CONFLICT; em recurso ⇒ FORBIDDEN", (action) => {
    expect(outcome(check(action, "AUTHORIZATION_ANALYST", subject()))).toBe("OK");
    expect(outcome(check(action, "AUTHORIZATION_ANALYST", subject({ assignedToAccountId: ME })))).toBe("OK");
    expect(outcome(check(action, "AUTHORIZATION_ANALYST", subject({ assignedToAccountId: OTHER })))).toBe("CONFLICT");
    expect(outcome(check(action, "AUTHORIZATION_ANALYST", subject({ isAppeal: true })))).toBe("FORBIDDEN");
  });

  it.each(["APPROVE", "REJECT", "REQUEST_INFO"] as const)("%s: supervisor só recursos; pedido normal ⇒ FORBIDDEN; o que decidiu a recusa de origem ⇒ FORBIDDEN, outro ⇒ OK", (action) => {
    expect(outcome(check(action, "SUPERVISOR", subject({ isAppeal: true, originDeciderAccountId: OTHER })))).toBe("OK");
    expect(outcome(check(action, "SUPERVISOR", subject()))).toBe("FORBIDDEN");
    expect(outcome(check(action, "SUPERVISOR", subject({ isAppeal: true, originDeciderAccountId: ME })))).toBe("FORBIDDEN");
  });

  it("quem recusou um pedido reaberto não volta a decidi-lo (BR-AUT-22); outro analista decide", () => {
    expect(outcome(check("APPROVE", "AUTHORIZATION_ANALYST", subject({ priorRejecterAccountId: ME })))).toBe("FORBIDDEN");
    expect(outcome(check("APPROVE", "AUTHORIZATION_ANALYST", subject({ priorRejecterAccountId: OTHER })))).toBe("OK");
  });

  it.each(["SUBMITTED", "INFO_REQUESTED", "APPROVED", "REJECTED", "CANCELLED"] as const)("estado %s ⇒ INVALID_STATE (409)", (status) => {
    expect(outcome(check("APPROVE", "AUTHORIZATION_ANALYST", subject({ status })))).toBe("INVALID_STATE");
  });
});

describe("atribuir", () => {
  it("analista toma um IN_REVIEW livre (ou já seu); de outro ⇒ CONFLICT; INFO_REQUESTED ⇒ INVALID_STATE", () => {
    expect(outcome(check("ASSIGN", "AUTHORIZATION_ANALYST", subject()))).toBe("OK");
    expect(outcome(check("ASSIGN", "AUTHORIZATION_ANALYST", subject({ assignedToAccountId: OTHER })))).toBe("CONFLICT");
    expect(outcome(check("ASSIGN", "AUTHORIZATION_ANALYST", subject({ status: "INFO_REQUESTED" })))).toBe("INVALID_STATE");
  });

  it("quem recusou o pedido (reaberto) não o toma de novo (BR-AUT-22)", () => {
    expect(outcome(check("ASSIGN", "AUTHORIZATION_ANALYST", subject({ priorRejecterAccountId: ME })))).toBe("FORBIDDEN");
    expect(outcome(check("ASSIGN", "AUTHORIZATION_ANALYST", subject({ priorRejecterAccountId: OTHER })))).toBe("OK");
  });

  it("supervisor atribui/reatribui IN_REVIEW e INFO_REQUESTED; recurso nunca se atribui (INVALID_STATE)", () => {
    expect(outcome(check("ASSIGN", "SUPERVISOR", subject({ assignedToAccountId: OTHER })))).toBe("OK");
    expect(outcome(check("ASSIGN", "SUPERVISOR", subject({ status: "INFO_REQUESTED" })))).toBe("OK");
    expect(outcome(check("ASSIGN", "SUPERVISOR", subject({ isAppeal: true })))).toBe("INVALID_STATE");
    expect(outcome(check("ASSIGN", "SUPERVISOR", subject({ status: "APPROVED" })))).toBe("INVALID_STATE");
    expect(outcome(check("ASSIGN", "AUTHORIZATION_ANALYST", subject({ isAppeal: true })))).toBe("INVALID_STATE");
  });

  it("libertar é do supervisor e só se há atribuição", () => {
    expect(outcome(check("UNASSIGN", "SUPERVISOR", subject({ assignedToAccountId: OTHER })))).toBe("OK");
    expect(outcome(check("UNASSIGN", "SUPERVISOR", subject()))).toBe("INVALID_STATE");
    expect(outcome(check("UNASSIGN", "AUTHORIZATION_ANALYST", subject({ assignedToAccountId: ME })))).toBe("FORBIDDEN");
  });
});

describe("reverter (CANCEL)", () => {
  const approved = (decidedByKind: ActionSubject["decidedByKind"]) => subject({ status: "APPROVED", decidedByKind });
  it.each([
    ["AUTHORIZATION_ANALYST", "ANALYST", "OK"],
    ["AUTHORIZATION_ANALYST", "SUPERVISOR", "FORBIDDEN"],
    ["AUTHORIZATION_ANALYST", "SYSTEM", "FORBIDDEN"],
    ["SUPERVISOR", "ANALYST", "OK"],
    ["SUPERVISOR", "SUPERVISOR", "OK"],
    ["SUPERVISOR", "SYSTEM", "OK"],
  ] as const)("%s sobre decisão de %s ⇒ %s (a automática só o supervisor reverte)", (role, decidedBy, expected) => {
    expect(outcome(check("CANCEL", role, approved(decidedBy)))).toBe(expected);
  });

  it("não-APPROVED ⇒ INVALID_STATE (409), antes da regra do decisor", () => {
    expect(outcome(check("CANCEL", "AUTHORIZATION_ANALYST", subject({ status: "REJECTED", decidedByKind: "SYSTEM" })))).toBe("INVALID_STATE");
  });
});

describe("reabrir (REOPEN)", () => {
  const rejected = (over: Partial<ActionSubject> = {}) => subject({ status: "REJECTED", decidedByKind: "ANALYST", decidedByAccountId: OTHER, appealWindowOpen: true, ...over });
  it("só supervisor, REJECTED dentro do prazo, sem recurso vivo ⇒ OK", () => {
    expect(outcome(check("REOPEN", "SUPERVISOR", rejected()))).toBe("OK");
    expect(outcome(check("REOPEN", "AUTHORIZATION_ANALYST", rejected()))).toBe("FORBIDDEN");
  });
  it("fora de prazo, outro estado ⇒ INVALID_STATE; recurso vivo ⇒ CONFLICT; quem o recusou ⇒ FORBIDDEN", () => {
    expect(outcome(check("REOPEN", "SUPERVISOR", rejected({ appealWindowOpen: false })))).toBe("INVALID_STATE");
    expect(outcome(check("REOPEN", "SUPERVISOR", subject({ status: "APPROVED" })))).toBe("INVALID_STATE");
    expect(outcome(check("REOPEN", "SUPERVISOR", rejected({ hasLiveAppeal: true })))).toBe("CONFLICT");
    expect(outcome(check("REOPEN", "SUPERVISOR", rejected({ decidedByAccountId: ME })))).toBe("FORBIDDEN");
  });
});

describe("acoesPermitidas (o que a UI mostra)", () => {
  it("analista num pedido normal livre: assign, approve, reject, request-info e anexos", () => {
    expect(acoesPermitidas({ role: "AUTHORIZATION_ANALYST", accountId: ME }, subject())).toEqual(["ASSIGN", "APPROVE", "REJECT", "REQUEST_INFO", "DOWNLOAD_ATTACHMENT"]);
  });
  it("supervisor num recurso: decide mas não atribui; numa recusa aberta: reabre; numa aprovação: reverte", () => {
    expect(acoesPermitidas({ role: "SUPERVISOR", accountId: ME }, subject({ isAppeal: true }))).toEqual(["APPROVE", "REJECT", "REQUEST_INFO", "DOWNLOAD_ATTACHMENT"]);
    expect(acoesPermitidas({ role: "SUPERVISOR", accountId: ME }, subject({ status: "REJECTED", appealWindowOpen: true, decidedByAccountId: OTHER }))).toEqual(["REOPEN", "DOWNLOAD_ATTACHMENT"]);
    expect(acoesPermitidas({ role: "SUPERVISOR", accountId: ME }, subject({ status: "APPROVED", decidedByKind: "SYSTEM" }))).toEqual(["CANCEL", "DOWNLOAD_ATTACHMENT"]);
  });
});
