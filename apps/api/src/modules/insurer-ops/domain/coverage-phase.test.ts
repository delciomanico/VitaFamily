// TC-PRC-26 (state-machines.md, Process, tabela 3; ADR-036): projeção pura dos pedidos de um processo no facto de cobertura.
import { describe, expect, it } from "vitest";
import type { AuthorizationStatus } from "./authorization-machine.js";
import { projectCoverage, type RequestForPhase } from "./coverage-phase.js";

const T = (hour: number) => new Date(Date.UTC(2026, 5, 1, hour));
const NOW = T(12);
let n = 0;
const req = (status: AuthorizationStatus, over: Partial<RequestForPhase> = {}): RequestForPhase => ({
  id: `r${String(++n).padStart(3, "0")}`,
  parentRequestId: null,
  status,
  closedReason: status === "CANCELLED" ? "CLINIC_CANCELLED" : null,
  decisionDueAt: T(10),
  validUntil: status === "APPROVED" ? T(23) : null,
  requestedAmount: 100,
  authorizedAmount: status === "APPROVED" ? 100 : null,
  updatedAt: T(8),
  ...over,
});
const withdrawn = (over: Partial<RequestForPhase> = {}) => req("CANCELLED", { closedReason: "ANALYST_CANCELLED", ...over });

describe("projectCoverage", () => {
  it("sem pedidos não há facto", () => {
    expect(projectCoverage([], NOW)).toBeUndefined();
  });

  it.each<[string, RequestForPhase, string]>([
    ["SUBMITTED", req("SUBMITTED"), "PENDING_DECISION"],
    ["IN_REVIEW", req("IN_REVIEW"), "PENDING_DECISION"],
    ["INFO_REQUESTED", req("INFO_REQUESTED"), "NEEDS_INFO"],
    ["APPROVED", req("APPROVED"), "APPROVED"],
    ["REJECTED", req("REJECTED"), "NOT_APPROVED"],
    ["APPROVED expirada", req("APPROVED", { validUntil: T(11) }), "EXPIRED"],
    ["CANCELLED ANALYST_CANCELLED", withdrawn(), "WITHDRAWN"],
    ["CANCELLED CLINIC_CANCELLED", req("CANCELLED"), "CLOSED"],
    ["CANCELLED INFO_TIMEOUT", req("CANCELLED", { closedReason: "INFO_TIMEOUT" }), "CLOSED"],
  ])("um pedido %s ⇒ %s", (_name, request, phase) => {
    expect(projectCoverage([request], NOW)?.phase).toBe(phase);
  });

  it("dueAt só em PENDING_DECISION e é o menor decisionDueAt dos pendentes", () => {
    const fact = projectCoverage([req("IN_REVIEW", { decisionDueAt: T(20) }), req("SUBMITTED", { decisionDueAt: T(12) }), req("APPROVED", { decisionDueAt: T(1) })], NOW);
    expect(fact).toMatchObject({ phase: "PENDING_DECISION", dueAt: T(12) });
    expect(projectCoverage([req("APPROVED")], NOW)).not.toHaveProperty("dueAt");
  });

  it("prioridade NEEDS_INFO > NOT_APPROVED > PENDING_DECISION > APPROVED > WITHDRAWN > EXPIRED > CLOSED", () => {
    const order = (): RequestForPhase[][] => [
      [req("INFO_REQUESTED"), req("REJECTED"), req("IN_REVIEW"), req("APPROVED"), withdrawn(), req("APPROVED", { validUntil: T(1) }), req("CANCELLED")],
      [req("REJECTED"), req("IN_REVIEW"), req("APPROVED"), withdrawn(), req("APPROVED", { validUntil: T(1) }), req("CANCELLED")],
      [req("IN_REVIEW"), req("APPROVED"), withdrawn(), req("APPROVED", { validUntil: T(1) })],
      [req("APPROVED"), withdrawn(), req("APPROVED", { validUntil: T(1) })],
      [withdrawn(), req("APPROVED", { validUntil: T(1) }), req("CANCELLED")],
      [req("APPROVED", { validUntil: T(1) }), req("CANCELLED")],
    ];
    expect(order().map((requests) => projectCoverage(requests, NOW)?.phase)).toEqual(["NEEDS_INFO", "NOT_APPROVED", "PENDING_DECISION", "APPROVED", "WITHDRAWN", "EXPIRED"]);
  });

  it("CANCELLED por CLINIC_CANCELLED/INFO_TIMEOUT ignoram-se; se todos o estão ⇒ CLOSED", () => {
    expect(projectCoverage([req("CANCELLED"), req("IN_REVIEW")], NOW)?.phase).toBe("PENDING_DECISION");
    expect(projectCoverage([req("CANCELLED"), req("CANCELLED", { closedReason: "INFO_TIMEOUT" })], NOW)).toMatchObject({ phase: "CLOSED", appeal: false, partial: false });
  });

  it("recusado com recurso não cancelado conta o recurso; com o recurso cancelado volta a contar a recusa", () => {
    const rejected = req("REJECTED");
    expect(projectCoverage([rejected, req("IN_REVIEW", { parentRequestId: rejected.id })], NOW)?.phase).toBe("PENDING_DECISION");
    expect(projectCoverage([rejected, req("CANCELLED", { parentRequestId: rejected.id })], NOW)?.phase).toBe("NOT_APPROVED");
    expect(projectCoverage([rejected, req("APPROVED", { parentRequestId: rejected.id })], NOW)?.phase).toBe("APPROVED");
  });

  it("appeal/partial/validUntil vêm do pedido determinante", () => {
    const rejected = req("REJECTED");
    expect(projectCoverage([rejected, req("IN_REVIEW", { parentRequestId: rejected.id })], NOW)).toMatchObject({ phase: "PENDING_DECISION", appeal: true, partial: false });
    expect(projectCoverage([rejected, req("REJECTED", { parentRequestId: rejected.id, updatedAt: T(9) })], NOW)).toMatchObject({ phase: "NOT_APPROVED", appeal: true });
    expect(projectCoverage([req("APPROVED", { authorizedAmount: 40, validUntil: T(20) })], NOW)).toMatchObject({ phase: "APPROVED", partial: true, appeal: false, validUntil: T(20) });
    expect(projectCoverage([req("APPROVED", { authorizedAmount: 100 })], NOW)).toMatchObject({ partial: false });
    // `partial` só em APPROVED; `validUntil` só em APPROVED e EXPIRED.
    const expired = projectCoverage([req("APPROVED", { authorizedAmount: 40, validUntil: T(11) })], NOW);
    expect(expired).toMatchObject({ phase: "EXPIRED", partial: false, validUntil: T(11) });
    expect(projectCoverage([withdrawn()], NOW)).not.toHaveProperty("validUntil");
    expect(projectCoverage([req("REJECTED")], NOW)).not.toHaveProperty("validUntil");
  });

  it("changedAt = o updatedAt mais recente (incluindo cancelados)", () => {
    expect(projectCoverage([req("IN_REVIEW", { updatedAt: T(9) }), req("CANCELLED", { updatedAt: T(15) })], NOW)?.changedAt).toEqual(T(15));
  });

  it("TC-DEC-15: aprovação com validUntil passada ⇒ EXPIRED (derivada); válida ⇒ APPROVED; não esconde um pedido pendente", () => {
    expect(projectCoverage([req("APPROVED", { validUntil: T(11) })], NOW)?.phase).toBe("EXPIRED");
    expect(projectCoverage([req("APPROVED", { validUntil: T(13) })], NOW)?.phase).toBe("APPROVED");
    expect(projectCoverage([req("APPROVED", { validUntil: T(1) }), req("IN_REVIEW")], NOW)?.phase).toBe("PENDING_DECISION");
  });
});
