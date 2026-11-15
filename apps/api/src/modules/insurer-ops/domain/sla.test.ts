// TC-DEC-11 (BR-AUT-20, Q-V2 A): `slaStatus` derivado, com o relógio como argumento; nunca por estado persistido.
import { describe, expect, it } from "vitest";
import type { AuthorizationStatus } from "./authorization-machine.js";
import { isOverdue, percentage, slaStatus } from "./sla.js";

const DUE = new Date("2026-11-15T10:00:00Z");
const at = (iso: string) => new Date(iso);
const subject = (status: AuthorizationStatus, decidedAt: Date | null = null) => ({ status, decisionDueAt: DUE, decidedAt });

describe("slaStatus", () => {
  it.each<[AuthorizationStatus, string | null, string, string | null]>([
    ["IN_REVIEW", null, "2026-11-15T09:59:59Z", "ON_TIME"],
    ["IN_REVIEW", null, "2026-11-15T10:00:00Z", "OVERDUE"],
    ["IN_REVIEW", null, "2026-11-30T10:00:00Z", "OVERDUE"],
    ["APPROVED", "2026-11-15T10:00:00Z", "2026-12-01T00:00:00Z", "MET"],
    ["REJECTED", "2026-11-15T10:00:01Z", "2026-12-01T00:00:00Z", "MISSED"],
    ["INFO_REQUESTED", null, "2026-12-01T00:00:00Z", null],
    ["SUBMITTED", null, "2026-12-01T00:00:00Z", null],
    ["CANCELLED", null, "2026-12-01T00:00:00Z", null],
  ])("%s decidido %s, agora %s ⇒ %s", (status, decidedAt, now, expected) => {
    expect(slaStatus(subject(status, decidedAt === null ? null : at(decidedAt)), at(now))).toBe(expected);
  });

  it("isOverdue: prazo atingido conta (a mesma comparação do job)", () => {
    expect(isOverdue({ decisionDueAt: DUE }, DUE)).toBe(true);
    expect(isOverdue({ decisionDueAt: DUE }, at("2026-11-15T09:59:59.999Z"))).toBe(false);
  });
});

describe("percentage", () => {
  it.each([[0, 0, null], [1, 3, 33.3], [2, 3, 66.7], [5, 5, 100], [0, 4, 0]])("%i/%i ⇒ %s", (part, total, expected) => {
    expect(percentage(part, total)).toBe(expected);
  });
});
