// TC-PRC-26 (state-machines.md, Process, tabela 3): projeção pura dos pedidos de um processo no facto de cobertura.
import { describe, expect, it } from "vitest";
import type { AuthorizationStatus } from "./authorization-machine.js";
import { projectCoverage, type RequestForPhase } from "./coverage-phase.js";

const T = (hour: number) => new Date(Date.UTC(2026, 5, 1, hour));
const NOW = T(12);
let n = 0;
const req = (status: AuthorizationStatus, over: Partial<RequestForPhase> = {}): RequestForPhase => ({ id: `r${String(++n)}`, parentRequestId: null, status, decisionDueAt: T(10), validUntil: status === "APPROVED" ? T(23) : null, updatedAt: T(8), ...over });

describe("projectCoverage", () => {
  it("sem pedidos não há facto", () => {
    expect(projectCoverage([], NOW)).toBeUndefined();
  });

  it.each<[AuthorizationStatus, string]>([
    ["SUBMITTED", "PENDING_DECISION"],
    ["IN_REVIEW", "PENDING_DECISION"],
    ["INFO_REQUESTED", "NEEDS_INFO"],
    ["APPROVED", "APPROVED"],
    ["REJECTED", "NOT_APPROVED"],
    ["CANCELLED", "CLOSED"],
  ])("um pedido %s ⇒ %s", (status, phase) => {
    expect(projectCoverage([req(status)], NOW)?.phase).toBe(phase);
  });

  it("dueAt só em PENDING_DECISION e é o menor decisionDueAt dos pendentes", () => {
    const fact = projectCoverage([req("IN_REVIEW", { decisionDueAt: T(20) }), req("SUBMITTED", { decisionDueAt: T(12) }), req("APPROVED", { decisionDueAt: T(1) })], NOW);
    expect(fact).toMatchObject({ phase: "PENDING_DECISION", dueAt: T(12) });
    expect(projectCoverage([req("APPROVED")], NOW)).not.toHaveProperty("dueAt");
  });

  it("prioridade NEEDS_INFO > NOT_APPROVED > PENDING_DECISION > APPROVED > CLOSED", () => {
    const order: AuthorizationStatus[][] = [
      ["INFO_REQUESTED", "REJECTED", "IN_REVIEW", "APPROVED", "CANCELLED"],
      ["REJECTED", "IN_REVIEW", "APPROVED", "CANCELLED"],
      ["IN_REVIEW", "APPROVED", "CANCELLED"],
      ["APPROVED", "CANCELLED"],
    ];
    expect(order.map((statuses) => projectCoverage(statuses.map((s) => req(s)), NOW)?.phase)).toEqual(["NEEDS_INFO", "NOT_APPROVED", "PENDING_DECISION", "APPROVED"]);
  });

  it("pedidos CANCELLED ignoram-se; se todos o estão ⇒ CLOSED", () => {
    expect(projectCoverage([req("CANCELLED"), req("IN_REVIEW")], NOW)?.phase).toBe("PENDING_DECISION");
    expect(projectCoverage([req("CANCELLED"), req("CANCELLED")], NOW)).toMatchObject({ phase: "CLOSED" });
  });

  it("recusado com recurso não cancelado conta o recurso; com o recurso cancelado volta a contar a recusa", () => {
    const rejected = req("REJECTED");
    expect(projectCoverage([rejected, req("IN_REVIEW", { parentRequestId: rejected.id })], NOW)?.phase).toBe("PENDING_DECISION");
    expect(projectCoverage([rejected, req("CANCELLED", { parentRequestId: rejected.id })], NOW)?.phase).toBe("NOT_APPROVED");
    expect(projectCoverage([rejected, req("APPROVED", { parentRequestId: rejected.id })], NOW)?.phase).toBe("APPROVED");
  });

  it("changedAt = o updatedAt mais recente (incluindo cancelados)", () => {
    expect(projectCoverage([req("IN_REVIEW", { updatedAt: T(9) }), req("CANCELLED", { updatedAt: T(15) })], NOW)?.changedAt).toEqual(T(15));
  });

  it("TC-DEC-15: aprovação com validUntil passada ⇒ CLOSED (expiração derivada); válida ⇒ APPROVED; sem relógio não há estado EXPIRED", () => {
    expect(projectCoverage([req("APPROVED", { validUntil: T(11) })], NOW)?.phase).toBe("CLOSED");
    expect(projectCoverage([req("APPROVED", { validUntil: T(13) })], NOW)?.phase).toBe("APPROVED");
    // Uma aprovação expirada não esconde um pedido pendente (agregação por prioridade).
    expect(projectCoverage([req("APPROVED", { validUntil: T(1) }), req("IN_REVIEW")], NOW)?.phase).toBe("PENDING_DECISION");
  });
});
