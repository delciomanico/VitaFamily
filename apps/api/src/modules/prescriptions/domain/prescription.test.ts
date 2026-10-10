import { describe, expect, it } from "vitest";
import { DomainError, ValidationError } from "../../../platform/errors/index.js";
import { assertHasMedications, assertValidIssuedOn, assertValidPrescriptionTransition } from "./prescription.js";

const NOW = new Date("2026-01-15T00:00:00.000Z");

describe("assertValidIssuedOn (BR-RX-01)", () => {
  it("aceita data passada ou igual a hoje", () => {
    expect(() => { assertValidIssuedOn("2026-01-15", NOW); }).not.toThrow();
    expect(() => { assertValidIssuedOn("2020-01-01", NOW); }).not.toThrow();
  });

  it("recusa data futura", () => {
    expect(() => { assertValidIssuedOn("2026-01-16", NOW); }).toThrow(ValidationError);
  });

  it("recusa data inválida", () => {
    expect(() => { assertValidIssuedOn("not-a-date", NOW); }).toThrow(ValidationError);
  });
});

describe("assertHasMedications (BR-RX-01)", () => {
  it("recusa receita sem medicamentos", () => {
    expect(() => { assertHasMedications(0); }).toThrow(ValidationError);
  });

  it("aceita 1+ medicamentos", () => {
    expect(() => { assertHasMedications(1); }).not.toThrow();
  });
});

describe("assertValidPrescriptionTransition (ST1)", () => {
  it("permite ACTIVE->COMPLETED/CANCELLED e reabrir", () => {
    expect(() => { assertValidPrescriptionTransition("ACTIVE", "COMPLETED"); }).not.toThrow();
    expect(() => { assertValidPrescriptionTransition("ACTIVE", "CANCELLED"); }).not.toThrow();
    expect(() => { assertValidPrescriptionTransition("COMPLETED", "ACTIVE"); }).not.toThrow();
    expect(() => { assertValidPrescriptionTransition("CANCELLED", "ACTIVE"); }).not.toThrow();
  });

  it("recusa COMPLETED->CANCELLED direto (tem de passar por ACTIVE)", () => {
    expect(() => { assertValidPrescriptionTransition("COMPLETED", "CANCELLED"); }).toThrow(DomainError);
  });
});
