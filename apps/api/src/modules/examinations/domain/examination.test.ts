import { describe, expect, it } from "vitest";
import { DomainError } from "../../../platform/errors/index.js";
import { assertValidExaminationTransition, deriveInitialExaminationStatus, type ExaminationStatus } from "./examination.js";

describe("deriveInitialExaminationStatus (ST5)", () => {
  const now = new Date("2026-01-15T12:00:00.000Z");

  it("examDate passada ou hoje nasce COMPLETED", () => {
    expect(deriveInitialExaminationStatus("2026-01-10", now)).toBe("COMPLETED");
    expect(deriveInitialExaminationStatus("2026-01-15", now)).toBe("COMPLETED");
  });

  it("examDate futura nasce SCHEDULED", () => {
    expect(deriveInitialExaminationStatus("2026-01-16", now)).toBe("SCHEDULED");
  });
});

describe("assertValidExaminationTransition (state-machines.md Examination)", () => {
  it.each<[ExaminationStatus, ExaminationStatus]>([
    ["SCHEDULED", "COMPLETED"],
    ["SCHEDULED", "CANCELLED"],
    ["CANCELLED", "SCHEDULED"],
    ["SCHEDULED", "SCHEDULED"],
    ["COMPLETED", "COMPLETED"],
  ])("permite %s -> %s", (from, to) => {
    expect(() => {
      assertValidExaminationTransition(from, to);
    }).not.toThrow();
  });

  it.each<[ExaminationStatus, ExaminationStatus]>([
    ["COMPLETED", "SCHEDULED"],
    ["COMPLETED", "CANCELLED"],
    ["CANCELLED", "COMPLETED"],
  ])("recusa %s -> %s", (from, to) => {
    expect(() => {
      assertValidExaminationTransition(from, to);
    }).toThrow(DomainError);
  });
});
