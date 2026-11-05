import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { assertCapacityAllowedForKind, assertValidCapacity, assertValidDurationMinutes, assertValidSlotKind, assertValidSpecialty, computeSlotOccupancy, isDuplicateSlot } from "./clinic-slot.js";

describe("assertValidSpecialty", () => {
  it("remove espaços nas pontas", () => {
    expect(assertValidSpecialty("  Cardiologia  ")).toBe("Cardiologia");
  });

  it("recusa especialidade vazia ou só espaços", () => {
    expect(() => assertValidSpecialty("")).toThrow();
    expect(() => assertValidSpecialty("   ")).toThrow();
  });
});

describe("assertValidDurationMinutes (BR-CLN-04)", () => {
  it.each([15, 20, 30, 45, 60])("aceita %i minutos", (value) => {
    expect(assertValidDurationMinutes(value)).toBe(value);
  });

  it.each([0, 10, 25, 90, -15])("recusa %i minutos", (value) => {
    expect(() => assertValidDurationMinutes(value)).toThrow();
  });
});

describe("isDuplicateSlot (BR-CLN-04)", () => {
  const base = { kind: "APPOINTMENT" as const, startsAt: new Date("2026-10-12T10:00:00Z"), specialty: "Cardiologia", professionalName: "Dr. Costa" };

  it("mesma hora, especialidade e profissional -> duplicado", () => {
    expect(isDuplicateSlot(base, { ...base })).toBe(true);
  });

  it("profissional diferente (incluindo ausente) -> não duplicado", () => {
    expect(isDuplicateSlot(base, { ...base, professionalName: "Dr. Silva" })).toBe(false);
    expect(isDuplicateSlot(base, { ...base, professionalName: undefined })).toBe(false);
  });

  it("hora ou especialidade diferentes -> não duplicado", () => {
    expect(isDuplicateSlot(base, { ...base, startsAt: new Date("2026-10-12T11:00:00Z") })).toBe(false);
    expect(isDuplicateSlot(base, { ...base, specialty: "Dermatologia" })).toBe(false);
  });

  it("mesmo instante/especialidade mas kind diferente (consulta vs exame) -> não duplicado (BR-APT-10)", () => {
    expect(isDuplicateSlot(base, { ...base, kind: "EXAM" })).toBe(false);
  });

  it("ambos sem profissional -> duplicado", () => {
    const noProfessional = { kind: base.kind, startsAt: base.startsAt, specialty: base.specialty, professionalName: undefined };
    expect(isDuplicateSlot(noProfessional, { ...noProfessional })).toBe(true);
  });
});

describe("assertValidSlotKind (BR-APT-10)", () => {
  it("ausente -> APPOINTMENT (default)", () => {
    expect(assertValidSlotKind(undefined)).toBe("APPOINTMENT");
    expect(assertValidSlotKind(null)).toBe("APPOINTMENT");
  });

  it.each(["APPOINTMENT", "EXAM"])("aceita %s", (value) => {
    expect(assertValidSlotKind(value)).toBe(value);
  });

  it("recusa valores desconhecidos", () => {
    expect(() => assertValidSlotKind("OTHER")).toThrow();
  });
});

describe("assertValidCapacity / assertCapacityAllowedForKind (BR-APT-11)", () => {
  it.each([1, 2, 25, 50])("aceita %i vagas", (value) => {
    expect(assertValidCapacity(value)).toBe(value);
  });

  it("ausente = 1", () => {
    expect(assertValidCapacity(undefined)).toBe(1);
  });

  it.each([0, -1, 51, 1.5, Number.NaN])("recusa %s vagas (VALIDATION_ERROR)", (value) => {
    expect(() => {
      assertValidCapacity(value);
    }).toThrow(ValidationError);
  });

  it("mais de 1 vaga só em EXAM", () => {
    expect(() => {
      assertCapacityAllowedForKind("EXAM", 10);
      assertCapacityAllowedForKind("APPOINTMENT", 1);
    }).not.toThrow();
    expect(() => {
      assertCapacityAllowedForKind("APPOINTMENT", 2);
    }).toThrow(ValidationError);
  });
});

describe("computeSlotOccupancy (BR-APT-11, ClinicSlotView.state)", () => {
  it.each([
    ["EXAM", 3, 0, 0, 0, 3, "FREE"],
    ["EXAM", 3, 0, 2, 2, 1, "PARTIAL"],
    ["EXAM", 3, 0, 3, 3, 0, "FULL"],
    ["EXAM", 1, 0, 1, 1, 0, "FULL"],
    ["APPOINTMENT", 1, 0, 0, 0, 1, "FREE"],
    ["APPOINTMENT", 1, 1, 0, 1, 0, "REQUESTED"],
    ["APPOINTMENT", 1, 0, 1, 1, 0, "SCHEDULED"],
  ] as const)("%s capacity %i requested %i scheduled %i -> booked %i remaining %i %s", (kind, capacity, requested, scheduled, bookedCount, remaining, state) => {
    expect(computeSlotOccupancy({ kind, capacity }, { requested, scheduled })).toEqual({ bookedCount, remaining, state });
  });
});
