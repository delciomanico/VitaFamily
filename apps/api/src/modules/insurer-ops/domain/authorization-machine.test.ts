// TC-AUT-01 (BR-AUT-03/08/14/15, state-machines.md S4 simplificado): a máquina é UM ficheiro de dados; os testes percorrem TODAS as
// transições legais com o ator exigido e rejeitam todas as outras (estado, ator, motivo de fecho).
import { describe, expect, it } from "vitest";
import { AUTHORIZATION_STATUSES, AUTHORIZATION_TRANSITIONS, FINAL_FOR_CLINIC_STATUSES, FINAL_STATUSES, checkTransition, isPending, type AuthorizationStatus, type TransitionActor } from "./authorization-machine.js";

const ACTORS: TransitionActor[] = ["CLINIC", "ANALYST", "SUPERVISOR", "SYSTEM"];
const FROM: (AuthorizationStatus | null)[] = [null, ...AUTHORIZATION_STATUSES];

describe("TC-AUT-01 máquina S4 (authorization-machine.ts)", () => {
  it("tem exatamente os 6 estados do contrato, sem AUTO_APPROVED/USED/EXPIRED", () => {
    expect([...AUTHORIZATION_STATUSES]).toEqual(["SUBMITTED", "IN_REVIEW", "INFO_REQUESTED", "APPROVED", "REJECTED", "CANCELLED"]);
    for (const banned of ["AUTO_APPROVED", "USED", "EXPIRED", "PARTIAL"]) expect(AUTHORIZATION_STATUSES).not.toContain(banned);
  });

  it.each(AUTHORIZATION_TRANSITIONS.map((t) => [t.name, t] as const))("transição legal %s com o ator exigido", (_name, t) => {
    const result = checkTransition(t.from, t.to, t.actor, t.closedReason);
    expect(result.ok).toBe(true);
  });

  it("rejeita TODAS as combinações (de, para, ator) que não estão na tabela", () => {
    let rejected = 0;
    for (const from of FROM) {
      for (const to of AUTHORIZATION_STATUSES) {
        for (const actor of ACTORS) {
          const legal = AUTHORIZATION_TRANSITIONS.find((t) => t.from === from && t.to === to && t.actor === actor);
          const result = checkTransition(from, to, actor, legal?.closedReason);
          expect(result.ok, `${String(from)} -> ${to} por ${actor}`).toBe(legal !== undefined);
          if (!result.ok) rejected++;
        }
      }
    }
    expect(rejected).toBeGreaterThan(100);
  });

  it("distingue transição ilegal de ator errado", () => {
    expect(checkTransition("SUBMITTED", "APPROVED", "ANALYST")).toEqual({ ok: false, reason: "WRONG_ACTOR" });
    expect(checkTransition("APPROVED", "APPROVED", "SYSTEM")).toEqual({ ok: false, reason: "ILLEGAL" });
    expect(checkTransition("IN_REVIEW", "APPROVED", "CLINIC")).toEqual({ ok: false, reason: "WRONG_ACTOR" });
    expect(checkTransition("INFO_REQUESTED", "IN_REVIEW", "SYSTEM")).toEqual({ ok: false, reason: "WRONG_ACTOR" });
  });

  it("CANCELLED é final; REJECTED só é final para a clínica (o supervisor reabre); a clínica não cancela um APPROVED", () => {
    for (const final of FINAL_STATUSES) expect(AUTHORIZATION_TRANSITIONS.filter((t) => t.from === final)).toEqual([]);
    for (const final of FINAL_FOR_CLINIC_STATUSES) expect(AUTHORIZATION_TRANSITIONS.filter((t) => t.from === final && t.actor === "CLINIC")).toEqual([]);
    expect(AUTHORIZATION_TRANSITIONS.filter((t) => t.from === "REJECTED").map((t) => `${t.name}:${t.actor}`)).toEqual(["REOPEN:SUPERVISOR"]);
    expect(checkTransition("APPROVED", "CANCELLED", "CLINIC", "CLINIC_CANCELLED").ok).toBe(false);
  });

  it("TC-DEC-01: aprovar/recusar/pedir informação por analista e supervisor; reverter com ANALYST_CANCELLED; reabrir só o supervisor", () => {
    for (const actor of ["ANALYST", "SUPERVISOR"] as const) {
      for (const to of ["APPROVED", "REJECTED", "INFO_REQUESTED"] as const) expect(checkTransition("IN_REVIEW", to, actor).ok).toBe(true);
      expect(checkTransition("APPROVED", "CANCELLED", actor, "ANALYST_CANCELLED").ok).toBe(true);
    }
    expect(checkTransition("SUBMITTED", "APPROVED", "SYSTEM")).toMatchObject({ ok: true, rule: { name: "AUTO_APPROVE" } });
    expect(checkTransition("REJECTED", "IN_REVIEW", "SUPERVISOR")).toMatchObject({ ok: true, rule: { name: "REOPEN" } });
    expect(checkTransition("REJECTED", "IN_REVIEW", "ANALYST")).toEqual({ ok: false, reason: "WRONG_ACTOR" });
    expect(checkTransition("APPROVED", "CANCELLED", "CLINIC", "ANALYST_CANCELLED")).toEqual({ ok: false, reason: "WRONG_ACTOR" });
    expect(checkTransition("APPROVED", "CANCELLED", "SUPERVISOR")).toEqual({ ok: false, reason: "CLOSED_REASON_REQUIRED" });
    for (const actor of ACTORS) expect(checkTransition("APPROVED", "APPROVED", actor).ok).toBe(false);
  });

  it("CANCELLED exige o motivo de fecho certo e os outros estados não admitem motivo", () => {
    expect(checkTransition("IN_REVIEW", "CANCELLED", "CLINIC")).toEqual({ ok: false, reason: "CLOSED_REASON_REQUIRED" });
    expect(checkTransition("IN_REVIEW", "CANCELLED", "CLINIC", "INFO_TIMEOUT")).toEqual({ ok: false, reason: "CLOSED_REASON_NOT_ALLOWED" });
    expect(checkTransition("INFO_REQUESTED", "CANCELLED", "SYSTEM", "INFO_TIMEOUT").ok).toBe(true);
    expect(checkTransition("SUBMITTED", "IN_REVIEW", "SYSTEM", "CLINIC_CANCELLED")).toEqual({ ok: false, reason: "CLOSED_REASON_NOT_ALLOWED" });
  });

  it("nunca aprova por silêncio (Q-V2 A): o sistema inicia a revisão, caduca pedidos de informação e só aprova por regra, na criação", () => {
    const bySystem = AUTHORIZATION_TRANSITIONS.filter((t) => t.actor === "SYSTEM").map((t) => `${String(t.from)}>${t.to}`);
    expect(bySystem.sort()).toEqual(["INFO_REQUESTED>CANCELLED", "SUBMITTED>APPROVED", "SUBMITTED>IN_REVIEW"]);
    expect(AUTHORIZATION_TRANSITIONS.filter((t) => t.actor === "SYSTEM" && t.to === "APPROVED").map((t) => t.from)).toEqual(["SUBMITTED"]);
  });

  it("pendente = SUBMITTED, IN_REVIEW, INFO_REQUESTED", () => {
    expect(AUTHORIZATION_STATUSES.filter(isPending)).toEqual(["SUBMITTED", "IN_REVIEW", "INFO_REQUESTED"]);
  });
});
