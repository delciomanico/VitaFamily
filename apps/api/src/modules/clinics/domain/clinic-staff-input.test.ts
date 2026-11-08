import { describe, expect, it } from "vitest";
import { parseStaffInput } from "./clinic-staff-input.js";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}

describe("parseStaffInput (BR-CLN-05/39)", () => {
  it.each([
    [{ email: " A@Clinica.pt " }, { email: "a@clinica.pt", role: "CLINIC_MANAGER" }],
    [{ email: "m@c.pt", role: "CLINIC_MANAGER" }, { email: "m@c.pt", role: "CLINIC_MANAGER" }],
    [{ email: "d@c.pt", role: "CLINIC_DOCTOR", professionalId: "p1" }, { email: "d@c.pt", role: "CLINIC_DOCTOR", professionalId: "p1" }],
  ])("aceita %j", (input, expected) => {
    expect(parseStaffInput(input)).toEqual(expected);
  });

  it.each([
    [{ email: "" }, "e-mail vazio"],
    [{ email: "x@c.pt", role: "CLINIC_ADMIN" }, "nunca CLINIC_ADMIN"],
    [{ email: "x@c.pt", role: "OTHER" }, "papel desconhecido"],
    [{ email: "x@c.pt", role: "CLINIC_DOCTOR" }, "Médico sem profissional"],
    [{ email: "x@c.pt", role: "CLINIC_MANAGER", professionalId: "p1" }, "Gestor com profissional"],
    [{ email: "x@c.pt", professionalId: "p1" }, "omissão = Gestor, com profissional"],
  ])("recusa %j (%s) com VALIDATION_ERROR", (input) => {
    expect(codeOf(() => parseStaffInput(input))).toBe("VALIDATION_ERROR");
  });
});
