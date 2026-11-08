// TC-CLN-09: estados e regras da visita presencial manual (BR-CLN-18, state-machines.md `ClinicVisit`).
import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "../../../platform/errors/index.js";
import { assertCanCancelVisit, assertCanCompleteVisit, assertNoPrescription, assertValidVisitTransition, normalizeVisitNote, type ClinicVisitStatus } from "./clinic-visit.js";

const NOW = new Date("2026-11-08T10:00:00.000Z");
const FUTURE = new Date("2026-11-09T10:00:00.000Z");

describe("assertValidVisitTransition", () => {
  it.each<[ClinicVisitStatus, ClinicVisitStatus, boolean]>([
    ["SCHEDULED", "COMPLETED", true],
    ["SCHEDULED", "CANCELLED", true],
    ["COMPLETED", "CANCELLED", false],
    ["COMPLETED", "SCHEDULED", false],
    ["CANCELLED", "SCHEDULED", false],
    ["CANCELLED", "COMPLETED", false],
  ])("%s -> %s permitido=%s", (from, to, allowed) => {
    if (allowed) expect(() => { assertValidVisitTransition(from, to); }).not.toThrow();
    else expect(() => { assertValidVisitTransition(from, to); }).toThrow(ConflictError);
  });
});

describe("cancelar / completar", () => {
  it("cancelar: só SCHEDULED e futura", () => {
    expect(() => { assertCanCancelVisit({ status: "SCHEDULED", scheduledAt: FUTURE }, NOW); }).not.toThrow();
    expect(() => { assertCanCancelVisit({ status: "SCHEDULED", scheduledAt: NOW }, NOW); }).toThrow(ConflictError);
    expect(() => { assertCanCancelVisit({ status: "COMPLETED", scheduledAt: FUTURE }, NOW); }).toThrow(ConflictError);
  });
  it("completar: só SCHEDULED (mesmo já passada, ST4)", () => {
    expect(() => { assertCanCompleteVisit({ status: "SCHEDULED" }); }).not.toThrow();
    expect(() => { assertCanCompleteVisit({ status: "CANCELLED" }); }).toThrow(ConflictError);
  });
  it("receita numa visita => VALIDATION_ERROR", () => {
    expect(() => { assertNoPrescription(undefined); }).not.toThrow();
    expect(() => { assertNoPrescription(null); }).not.toThrow();
    expect(() => { assertNoPrescription({ medications: [] }); }).toThrow(ValidationError);
  });
  it("notas: aparadas, vazias => null, > 2000 => 422", () => {
    expect(normalizeVisitNote("  x ", "notes")).toBe("x");
    expect(normalizeVisitNote("   ", "notes")).toBeNull();
    expect(normalizeVisitNote(undefined, "notes")).toBeNull();
    expect(() => normalizeVisitNote("x".repeat(2001), "notes")).toThrow(ValidationError);
  });
});
