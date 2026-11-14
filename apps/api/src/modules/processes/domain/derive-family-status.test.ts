// TC-PRC-01..07 (AC-PRC-02, BR-PRC-02/03): tabela de verdade de `deriveFamilyStatus`.
import { describe, expect, it } from "vitest";
import type { components } from "../../../generated/openapi.js";
import { deriveFamilyStatus } from "./derive-family-status.js";
import { ACT_PHASES, COVERAGE_PHASES, type ActPhase, type CoveragePhase, type FamilyStatus, type NextStepActor, type NextStepCode } from "./process.js";

type Contract = components["schemas"];

describe("deriveFamilyStatus — tabela de verdade (state-machines.md, Process)", () => {
  it.each<[string, ActPhase, FamilyStatus, NextStepCode, NextStepActor]>([
    ["TC-PRC-01", "PENDING", "SCHEDULED", "AWAIT_CLINIC_RESPONSE", "CLINIC"],
    ["TC-PRC-02", "SCHEDULED", "SCHEDULED", "ATTEND", "FAMILY"],
    ["TC-PRC-03", "IN_PROGRESS", "IN_PROGRESS", "BEING_ATTENDED", "CLINIC"],
    ["TC-PRC-04", "DONE", "DONE", "NOTHING_PENDING", "NONE"],
    ["TC-PRC-05", "CANCELLED", "CANCELLED", "NOTHING_PENDING", "NONE"],
    ["TC-PRC-06", "NO_SHOW", "CANCELLED", "RESCHEDULE", "FAMILY"],
  ])("%s: phase=%s => %s / %s / %s", (_id, phase, familyStatus, code, actor) => {
    expect(deriveFamilyStatus({ act: { phase } })).toEqual({ familyStatus, nextStep: { code, actor } });
  });

  it("TC-PRC-07: totalidade — toda a fase do contrato dá um dos 4 estados e um par code/actor do contrato", () => {
    // Compila só se `ACT_PHASES` cobre exatamente `ProcessActPhase` do contrato (ambos os sentidos).
    const contractPhases: Contract["ProcessActPhase"][] = [...ACT_PHASES];
    const asDomain: ActPhase[] = contractPhases;
    expect(asDomain).toHaveLength(6);

    const statuses: Contract["ProcessFamilyStatus"][] = ["SCHEDULED", "IN_PROGRESS", "DONE", "CANCELLED"];
    const codes: Contract["ProcessNextStepCode"][] = ["AWAIT_CLINIC_RESPONSE", "ATTEND", "BEING_ATTENDED", "RESCHEDULE", "NOTHING_PENDING", "AWAIT_INSURER_DECISION", "AWAIT_CLINIC_INFORMATION", "COVERAGE_NOT_APPROVED"];
    const actors: Contract["ProcessNextStepActor"][] = ["FAMILY", "CLINIC", "INSURER", "NONE"];
    for (const phase of contractPhases) {
      const view = deriveFamilyStatus({ act: { phase } });
      expect(statuses).toContain(view.familyStatus);
      expect(codes).toContain(view.nextStep.code);
      expect(actors).toContain(view.nextStep.actor);
    }
  });

  it("TC-PRC-07: pureza — mesma entrada, mesma saída; o resultado devolvido não altera a tabela", () => {
    const first = deriveFamilyStatus({ act: { phase: "SCHEDULED" } });
    first.nextStep.code = "NOTHING_PENDING";
    expect(deriveFamilyStatus({ act: { phase: "SCHEDULED" } })).toEqual({ familyStatus: "SCHEDULED", nextStep: { code: "ATTEND", actor: "FAMILY" } });
  });
});

// TC-PRC-25 (state-machines.md, Process, tabela 3): `deriveFamilyStatus({act?, coverage?})`; as 6 linhas da fatia 1 não mudam.
const DUE = new Date("2026-06-03T10:00:00Z");
describe("deriveFamilyStatus — facto de cobertura (fatia 3)", () => {
  type Row = [CoveragePhase, FamilyStatus, NextStepCode, NextStepActor];
  const OVER: Row[] = [
    ["PENDING_DECISION", "IN_PROGRESS", "AWAIT_INSURER_DECISION", "INSURER"],
    ["NEEDS_INFO", "IN_PROGRESS", "AWAIT_CLINIC_INFORMATION", "CLINIC"],
    ["NOT_APPROVED", "IN_PROGRESS", "COVERAGE_NOT_APPROVED", "CLINIC"],
  ];

  it.each(OVER.flatMap((row) => (["PENDING", "SCHEDULED"] as const).map((phase) => [phase, ...row] as const)))("com ato %s e cobertura %s => %s / %s / %s", (phase, coverage, familyStatus, code, actor) => {
    const view = deriveFamilyStatus({ act: { phase }, coverage: { phase: coverage, dueAt: DUE } });
    expect(view).toMatchObject({ familyStatus, nextStep: { code, actor } });
    expect(view.nextStep.dueAt).toEqual(code === "AWAIT_INSURER_DECISION" ? DUE : undefined);
  });

  it.each(["APPROVED", "CLOSED"] as const)("com ato por começar e cobertura %s => a linha do ato (inalterada)", (coverage) => {
    for (const phase of ["PENDING", "SCHEDULED"] as const) {
      expect(deriveFamilyStatus({ act: { phase }, coverage: { phase: coverage } })).toEqual(deriveFamilyStatus({ act: { phase } }));
    }
  });

  it("ato IN_PROGRESS/DONE/CANCELLED/NO_SHOW ignora a cobertura (qualquer fase)", () => {
    for (const phase of ["IN_PROGRESS", "DONE", "CANCELLED", "NO_SHOW"] as const) {
      for (const coverage of COVERAGE_PHASES) {
        expect(deriveFamilyStatus({ act: { phase }, coverage: { phase: coverage, dueAt: DUE } })).toEqual(deriveFamilyStatus({ act: { phase } }));
      }
    }
  });

  it.each<Row>([
    ["PENDING_DECISION", "IN_PROGRESS", "AWAIT_INSURER_DECISION", "INSURER"],
    ["NEEDS_INFO", "IN_PROGRESS", "AWAIT_CLINIC_INFORMATION", "CLINIC"],
    ["NOT_APPROVED", "IN_PROGRESS", "COVERAGE_NOT_APPROVED", "CLINIC"],
    ["APPROVED", "IN_PROGRESS", "ATTEND", "FAMILY"],
    ["CLOSED", "CANCELLED", "NOTHING_PENDING", "NONE"],
  ])("sem ato e cobertura %s => %s / %s / %s (nunca DONE)", (phase, familyStatus, code, actor) => {
    const view = deriveFamilyStatus({ coverage: { phase, dueAt: DUE } });
    expect(view).toMatchObject({ familyStatus, nextStep: { code, actor } });
    expect(view.familyStatus).not.toBe("DONE");
  });

  it("totalidade: toda a fase de cobertura dá um estado e um passo do contrato", () => {
    const statuses: Contract["ProcessFamilyStatus"][] = ["SCHEDULED", "IN_PROGRESS", "DONE", "CANCELLED"];
    for (const phase of COVERAGE_PHASES) expect(statuses).toContain(deriveFamilyStatus({ coverage: { phase } }).familyStatus);
  });

  it("pureza: o resultado devolvido não altera a tabela (dueAt incluído)", () => {
    const first = deriveFamilyStatus({ coverage: { phase: "PENDING_DECISION", dueAt: DUE } });
    first.nextStep.code = "NOTHING_PENDING";
    delete first.nextStep.dueAt;
    expect(deriveFamilyStatus({ coverage: { phase: "PENDING_DECISION", dueAt: DUE } }).nextStep).toEqual({ code: "AWAIT_INSURER_DECISION", actor: "INSURER", dueAt: DUE });
  });
});
