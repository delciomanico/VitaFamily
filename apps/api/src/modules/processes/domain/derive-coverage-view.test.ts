// TC-PRC-29 (BR-PRC-12/13/14): tabela de verdade de `deriveCoverageView` — pura, só estado e datas.
import { describe, expect, it } from "vitest";
import type { components } from "../../../generated/openapi.js";
import { deriveCoverageView, type CoverageViewState } from "./derive-coverage-view.js";
import { ACT_PHASES, COVERAGE_PHASES, type CoverageFact, type CoveragePhase } from "./process.js";

const DUE = new Date("2026-06-03T10:00:00Z");
const UNTIL = new Date("2026-07-01T10:00:00Z");
const fact = (phase: CoveragePhase, over: Partial<CoverageFact> = {}): CoverageFact => ({ phase, appeal: false, partial: false, changedAt: new Date("2026-06-01T00:00:00Z"), ...over });

describe("deriveCoverageView", () => {
  it.each<[CoveragePhase, CoverageViewState, Partial<CoverageFact>, object]>([
    ["PENDING_DECISION", "PENDING", { dueAt: DUE }, { dueAt: DUE }],
    ["NEEDS_INFO", "NEEDS_INFO", {}, {}],
    ["APPROVED", "APPROVED", { validUntil: UNTIL, partial: true }, { validUntil: UNTIL, partial: true }],
    ["NOT_APPROVED", "NOT_APPROVED", {}, {}],
    ["EXPIRED", "EXPIRED", { validUntil: UNTIL }, { validUntil: UNTIL }],
    ["WITHDRAWN", "WITHDRAWN", {}, {}],
  ])("%s => %s", (phase, state, over, expected) => {
    expect(deriveCoverageView({ coverage: fact(phase, over) })).toEqual({ state, appeal: false, partial: false, ...expected });
  });

  it("CLOSED e sem facto => null", () => {
    expect(deriveCoverageView({ coverage: fact("CLOSED") })).toBeNull();
    expect(deriveCoverageView({})).toBeNull();
    expect(deriveCoverageView({ act: { phase: "SCHEDULED" } })).toBeNull();
  });

  it("appeal propaga-se; partial só em APPROVED; dueAt só em PENDING; validUntil só em APPROVED/EXPIRED", () => {
    expect(deriveCoverageView({ coverage: fact("NOT_APPROVED", { appeal: true }) })).toMatchObject({ state: "NOT_APPROVED", appeal: true });
    expect(deriveCoverageView({ coverage: fact("EXPIRED", { partial: true, dueAt: DUE, validUntil: UNTIL }) })).toEqual({ state: "EXPIRED", appeal: false, partial: false, validUntil: UNTIL });
    expect(deriveCoverageView({ coverage: fact("PENDING_DECISION", { dueAt: DUE, validUntil: UNTIL }) })).toEqual({ state: "PENDING", appeal: false, partial: false, dueAt: DUE });
  });

  it.each(ACT_PHASES)("ato %s: DONE/CANCELLED => null; os restantes mantêm (NO_SHOW incluído)", (phase) => {
    const view = deriveCoverageView({ act: { phase }, coverage: fact("APPROVED", { validUntil: UNTIL }) });
    if (phase === "DONE" || phase === "CANCELLED") expect(view).toBeNull();
    else expect(view).toMatchObject({ state: "APPROVED" });
  });

  it("totalidade: todo o estado pertence ao contrato e o objeto só tem campos do contrato", () => {
    const contract: Contract["ProcessCoverageState"][] = ["PENDING", "NEEDS_INFO", "APPROVED", "NOT_APPROVED", "EXPIRED", "WITHDRAWN"];
    const allowedKeys = ["state", "appeal", "partial", "dueAt", "validUntil"];
    for (const phase of COVERAGE_PHASES) {
      const view = deriveCoverageView({ coverage: fact(phase, { dueAt: DUE, validUntil: UNTIL, partial: true, appeal: true }) });
      if (view === null) continue;
      expect(contract).toContain(view.state);
      expect(Object.keys(view).every((key) => allowedKeys.includes(key))).toBe(true);
    }
  });
});

type Contract = components["schemas"];
