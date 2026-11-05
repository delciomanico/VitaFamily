import { describe, expect, it } from "vitest";
import { DomainError } from "../../../platform/errors/index.js";
import {
  assertValidClinicCompletion,
  assertValidExaminationTransition,
  deriveInitialExaminationStatus,
  localExamDate,
  type ExaminationStatus,
} from "./examination.js";

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

describe("BR-EXM-08: exame de clínica parceira (slotId) cancelado não se reagenda", () => {
  it("CANCELLED -> SCHEDULED recusado com slot, permitido sem slot", () => {
    expect(() => {
      assertValidExaminationTransition("CANCELLED", "SCHEDULED", { hasSlot: true });
    }).toThrow(DomainError);
    expect(() => {
      assertValidExaminationTransition("CANCELLED", "SCHEDULED", { hasSlot: false });
    }).not.toThrow();
  });
});

describe("localExamDate (BR-EXM-05)", () => {
  it("usa a data local de Lisboa (verão UTC+1 / inverno UTC+0)", () => {
    expect(localExamDate(new Date("2026-07-10T23:30:00.000Z"))).toBe("2026-07-11");
    expect(localExamDate(new Date("2026-01-10T23:30:00.000Z"))).toBe("2026-01-10");
  });
});

describe("assertValidClinicCompletion (BR-CLN-08)", () => {
  it("aceita resultados sem PDF, PDF sem resultados, e ambos", () => {
    expect(() => {
      assertValidClinicCompletion({ resultsCount: 2, documentsCount: 0 });
    }).not.toThrow();
    expect(() => {
      assertValidClinicCompletion({ resultsCount: 0, documentsCount: 1 });
    }).not.toThrow();
    expect(() => {
      assertValidClinicCompletion({ resultsCount: 50, documentsCount: 5, resultNote: "x".repeat(2000) });
    }).not.toThrow();
  });

  it.each([
    [{ resultsCount: 0, documentsCount: 0 }],
    [{ resultsCount: 51, documentsCount: 0 }],
    [{ resultsCount: 1, documentsCount: 0, resultNote: "x".repeat(2001) }],
  ])("recusa %j (VALIDATION_ERROR)", (params) => {
    expect(() => {
      assertValidClinicCompletion(params);
    }).toThrowError(expect.objectContaining({ code: "VALIDATION_ERROR" }) as Error);
  });
});
