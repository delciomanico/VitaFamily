// TC-PRC-01..07 (AC-PRC-02, BR-PRC-02/03): tabela de verdade de `deriveFamilyStatus`.
import { describe, expect, it } from "vitest";
import type { components } from "../../../generated/openapi.js";
import { deriveFamilyStatus } from "./derive-family-status.js";
import { ACT_PHASES, type ActPhase, type FamilyStatus, type NextStepActor, type NextStepCode } from "./process.js";

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
    const codes: Contract["ProcessNextStepCode"][] = ["AWAIT_CLINIC_RESPONSE", "ATTEND", "BEING_ATTENDED", "RESCHEDULE", "NOTHING_PENDING"];
    const actors: Contract["ProcessNextStepActor"][] = ["FAMILY", "CLINIC", "NONE"];
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
