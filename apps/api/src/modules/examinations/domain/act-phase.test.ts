// TC-PRC-09 (BR-PRC-04/09): projeção estado do exame -> `phase`.
import { describe, expect, it } from "vitest";
import { ActIntegrityError, projectActPhase, type ActPhase } from "./act-phase.js";

describe("projectActPhase (exames)", () => {
  it.each<[string, ActPhase]>([
    ["SCHEDULED", "SCHEDULED"],
    ["COMPLETED", "DONE"],
    ["CANCELLED", "CANCELLED"],
  ])("%s => %s", (status, expected) => {
    expect(projectActPhase(status)).toBe(expected);
  });

  it.each(["REQUESTED", "REJECTED"])("%s (obsoleto, ADR-023) => erro de integridade", (status) => {
    expect(() => projectActPhase(status)).toThrow(ActIntegrityError);
  });
});
