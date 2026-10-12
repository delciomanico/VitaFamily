import { describe, expect, it } from "vitest";
import { assertValidDurationMinutes, assertValidSpecialty, isDuplicateSlot } from "./clinic-slot.js";

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
  const base = { startsAt: new Date("2026-10-12T10:00:00Z"), specialty: "Cardiologia", professionalName: "Dr. Costa" };

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

  it("ambos sem profissional -> duplicado", () => {
    const noProfessional = { startsAt: base.startsAt, specialty: base.specialty, professionalName: undefined };
    expect(isDuplicateSlot(noProfessional, { ...noProfessional })).toBe(true);
  });
});
