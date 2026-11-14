// TC-AUT-01 (BR-AUT-03/08/14/15, state-machines.md S4 simplificado): a máquina é UM ficheiro de dados; os testes percorrem TODAS as
// transições legais com o ator exigido e rejeitam todas as outras (estado, ator, motivo de fecho).
import { describe, expect, it } from "vitest";
import { AUTHORIZATION_STATUSES, AUTHORIZATION_TRANSITIONS, FINAL_STATUSES, checkTransition, isPending, type AuthorizationStatus, type TransitionActor } from "./authorization-machine.js";

const ACTORS: TransitionActor[] = ["CLINIC", "ANALYST", "SYSTEM"];
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
    expect(checkTransition("SUBMITTED", "APPROVED", "ANALYST")).toEqual({ ok: false, reason: "ILLEGAL" });
    expect(checkTransition("IN_REVIEW", "APPROVED", "CLINIC")).toEqual({ ok: false, reason: "WRONG_ACTOR" });
    expect(checkTransition("INFO_REQUESTED", "IN_REVIEW", "SYSTEM")).toEqual({ ok: false, reason: "WRONG_ACTOR" });
  });

  it("REJECTED e CANCELLED são finais; a clínica não cancela um APPROVED (fatia 4)", () => {
    for (const final of FINAL_STATUSES) {
      expect(AUTHORIZATION_TRANSITIONS.filter((t) => t.from === final)).toEqual([]);
    }
    expect(checkTransition("APPROVED", "CANCELLED", "CLINIC", "CLINIC_CANCELLED").ok).toBe(false);
  });

  it("CANCELLED exige o motivo de fecho certo e os outros estados não admitem motivo", () => {
    expect(checkTransition("IN_REVIEW", "CANCELLED", "CLINIC")).toEqual({ ok: false, reason: "CLOSED_REASON_REQUIRED" });
    expect(checkTransition("IN_REVIEW", "CANCELLED", "CLINIC", "INFO_TIMEOUT")).toEqual({ ok: false, reason: "CLOSED_REASON_NOT_ALLOWED" });
    expect(checkTransition("INFO_REQUESTED", "CANCELLED", "SYSTEM", "INFO_TIMEOUT").ok).toBe(true);
    expect(checkTransition("SUBMITTED", "IN_REVIEW", "SYSTEM", "CLINIC_CANCELLED")).toEqual({ ok: false, reason: "CLOSED_REASON_NOT_ALLOWED" });
  });

  it("nunca aprova por silêncio (Q-V2 A): o sistema só inicia a revisão e caduca pedidos de informação", () => {
    const bySystem = AUTHORIZATION_TRANSITIONS.filter((t) => t.actor === "SYSTEM").map((t) => `${String(t.from)}>${t.to}`);
    expect(bySystem.sort()).toEqual(["INFO_REQUESTED>CANCELLED", "SUBMITTED>IN_REVIEW"]);
  });

  it("pendente = SUBMITTED, IN_REVIEW, INFO_REQUESTED", () => {
    expect(AUTHORIZATION_STATUSES.filter(isPending)).toEqual(["SUBMITTED", "IN_REVIEW", "INFO_REQUESTED"]);
  });
});
