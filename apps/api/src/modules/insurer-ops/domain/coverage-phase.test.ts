// TC-PRC-26 (state-machines.md, Process, tabela 3): projeção pura dos pedidos de um processo no facto de cobertura.
import { describe, expect, it } from "vitest";
import type { AuthorizationStatus } from "./authorization-machine.js";
import { projectCoverage, type RequestForPhase } from "./coverage-phase.js";

const T = (hour: number) => new Date(Date.UTC(2026, 5, 1, hour));
let n = 0;
const req = (status: AuthorizationStatus, over: Partial<RequestForPhase> = {}): RequestForPhase => ({ id: `r${String(++n)}`, parentRequestId: null, status, decisionDueAt: T(10), updatedAt: T(8), ...over });

describe("projectCoverage", () => {
  it("sem pedidos não há facto", () => {
    expect(projectCoverage([])).toBeUndefined();
  });

  it.each<[AuthorizationStatus, string]>([
    ["SUBMITTED", "PENDING_DECISION"],
    ["IN_REVIEW", "PENDING_DECISION"],
    ["INFO_REQUESTED", "NEEDS_INFO"],
    ["APPROVED", "APPROVED"],
    ["REJECTED", "NOT_APPROVED"],
    ["CANCELLED", "CLOSED"],
  ])("um pedido %s ⇒ %s", (status, phase) => {
    expect(projectCoverage([req(status)])?.phase).toBe(phase);
  });

  it("dueAt só em PENDING_DECISION e é o menor decisionDueAt dos pendentes", () => {
    const fact = projectCoverage([req("IN_REVIEW", { decisionDueAt: T(20) }), req("SUBMITTED", { decisionDueAt: T(12) }), req("APPROVED", { decisionDueAt: T(1) })]);
    expect(fact).toMatchObject({ phase: "PENDING_DECISION", dueAt: T(12) });
    expect(projectCoverage([req("APPROVED")])).not.toHaveProperty("dueAt");
  });

  it("prioridade NEEDS_INFO > NOT_APPROVED > PENDING_DECISION > APPROVED > CLOSED", () => {
    const order: AuthorizationStatus[][] = [
      ["INFO_REQUESTED", "REJECTED", "IN_REVIEW", "APPROVED", "CANCELLED"],
      ["REJECTED", "IN_REVIEW", "APPROVED", "CANCELLED"],
      ["IN_REVIEW", "APPROVED", "CANCELLED"],
      ["APPROVED", "CANCELLED"],
    ];
    expect(order.map((statuses) => projectCoverage(statuses.map((s) => req(s)))?.phase)).toEqual(["NEEDS_INFO", "NOT_APPROVED", "PENDING_DECISION", "APPROVED"]);
  });

  it("pedidos CANCELLED ignoram-se; se todos o estão ⇒ CLOSED", () => {
    expect(projectCoverage([req("CANCELLED"), req("IN_REVIEW")])?.phase).toBe("PENDING_DECISION");
    expect(projectCoverage([req("CANCELLED"), req("CANCELLED")])).toMatchObject({ phase: "CLOSED" });
  });

  it("recusado com recurso não cancelado conta o recurso; com o recurso cancelado volta a contar a recusa", () => {
    const rejected = req("REJECTED");
    expect(projectCoverage([rejected, req("IN_REVIEW", { parentRequestId: rejected.id })])?.phase).toBe("PENDING_DECISION");
    expect(projectCoverage([rejected, req("CANCELLED", { parentRequestId: rejected.id })])?.phase).toBe("NOT_APPROVED");
    expect(projectCoverage([rejected, req("APPROVED", { parentRequestId: rejected.id })])?.phase).toBe("APPROVED");
  });

  it("changedAt = o updatedAt mais recente (incluindo cancelados)", () => {
    expect(projectCoverage([req("IN_REVIEW", { updatedAt: T(9) }), req("CANCELLED", { updatedAt: T(15) })])?.changedAt).toEqual(T(15));
  });
});
