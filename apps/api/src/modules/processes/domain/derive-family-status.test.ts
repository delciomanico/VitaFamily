// TC-PRC-01..07 (AC-PRC-02, BR-PRC-02/03): tabela de verdade de `deriveFamilyStatus`.
import { describe, expect, it } from "vitest";
import type { components } from "../../../generated/openapi.js";
import { deriveFamilyStatus } from "./derive-family-status.js";
import { ACT_PHASES, BOOKING_HINTS, categoryOfOrigin, type ActPhase, type BookingHint, type FamilyStatus, type NextStepActor, type NextStepCode } from "./process.js";

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

describe("deriveFamilyStatus — linhas de BOOKING (state-machines.md 2b, TC-MKT-88 (U))", () => {
  type Row = [ActPhase, BookingHint | null, FamilyStatus, NextStepCode, NextStepActor];
  const rows: Row[] = [
    ["PENDING", null, "SCHEDULED", "AWAIT_PROFESSIONAL_RESPONSE", "PROFESSIONAL"],
    ["SCHEDULED", null, "SCHEDULED", "ATTEND", "FAMILY"],
    ["SCHEDULED", "PAYMENT_PROOF_DUE", "SCHEDULED", "SEND_PAYMENT_PROOF", "FAMILY"],
    ["SCHEDULED", "PAYMENT_UNDER_REVIEW", "SCHEDULED", "AWAIT_PAYMENT_CONFIRMATION", "PROFESSIONAL"],
    ["SCHEDULED", "PAYMENT_DISPUTED", "SCHEDULED", "AWAIT_PAYMENT_DISPUTE_DECISION", "PLATFORM"],
    ["DONE", null, "DONE", "NOTHING_PENDING", "NONE"],
    ["DONE", "PAYMENT_PROOF_DUE", "DONE", "SEND_PAYMENT_PROOF", "FAMILY"],
    ["DONE", "PAYMENT_UNDER_REVIEW", "DONE", "AWAIT_PAYMENT_CONFIRMATION", "PROFESSIONAL"],
    ["DONE", "PAYMENT_DISPUTED", "DONE", "AWAIT_PAYMENT_DISPUTE_DECISION", "PLATFORM"],
    ["DONE", "REVIEW_DUE", "DONE", "LEAVE_REVIEW", "FAMILY"],
    ["CANCELLED", null, "CANCELLED", "NOTHING_PENDING", "NONE"],
    ["NO_SHOW", null, "CANCELLED", "RESCHEDULE", "FAMILY"],
  ];

  it.each(rows)("phase=%s hint=%s => %s / %s / %s", (phase, hint, familyStatus, code, actor) => {
    const act = hint === null ? { source: "BOOKING" as const, phase } : { source: "BOOKING" as const, phase, hint };
    expect(deriveFamilyStatus({ act })).toEqual({ familyStatus, nextStep: { code, actor } });
  });

  it("hint nulo e ausente dão o mesmo resultado", () => {
    expect(deriveFamilyStatus({ act: { source: "BOOKING", phase: "SCHEDULED", hint: null } })).toEqual(deriveFamilyStatus({ act: { source: "BOOKING", phase: "SCHEDULED" } }));
  });

  it("totalidade: todas as fases × todos os hints de BOOKING dão um resultado; combinações não listadas valem como hint nulo", () => {
    const listed = new Set(rows.filter((r) => r[1] !== null).map((r) => `${r[0]}/${String(r[1])}`));
    for (const phase of ACT_PHASES) {
      const noHint = deriveFamilyStatus({ act: { source: "BOOKING", phase } });
      for (const hint of BOOKING_HINTS) {
        const view = deriveFamilyStatus({ act: { source: "BOOKING", phase, hint } });
        expect(view.familyStatus).toBeDefined();
        if (!listed.has(`${phase}/${hint}`)) expect(view).toEqual(noHint);
      }
    }
  });

  it("IN_PROGRESS não existe para marcações: cai na linha do ato (função total)", () => {
    expect(deriveFamilyStatus({ act: { source: "BOOKING", phase: "IN_PROGRESS" } })).toEqual(deriveFamilyStatus({ act: { phase: "IN_PROGRESS" } }));
  });

  it("o hint nunca altera os atos APPOINTMENT/EXAMINATION (as 6 linhas de cima mantêm-se)", () => {
    for (const source of ["APPOINTMENT", "EXAMINATION"] as const) {
      for (const phase of ACT_PHASES) {
        for (const hint of BOOKING_HINTS) expect(deriveFamilyStatus({ act: { source, phase, hint } })).toEqual(deriveFamilyStatus({ act: { phase } }));
      }
    }
  });

  it("a leitura de um processo BOOKING exige a categoria APPOINTMENTS (BR-MKT-55)", () => {
    expect(categoryOfOrigin("BOOKING")).toBe("APPOINTMENTS");
    expect(categoryOfOrigin("APPOINTMENT")).toBe("APPOINTMENTS");
    expect(categoryOfOrigin("EXAMINATION")).toBe("EXAMS");
  });

  it("os valores novos de nextStep.code/actor existem no contrato OpenAPI", () => {
    const codes: Contract["ProcessNextStepCode"][] = ["AWAIT_PROFESSIONAL_RESPONSE", "SEND_PAYMENT_PROOF", "AWAIT_PAYMENT_CONFIRMATION", "AWAIT_PAYMENT_DISPUTE_DECISION", "LEAVE_REVIEW"];
    const actors: Contract["ProcessNextStepActor"][] = ["PROFESSIONAL", "PLATFORM"];
    expect(codes).toHaveLength(5);
    expect(actors).toHaveLength(2);
  });
});
