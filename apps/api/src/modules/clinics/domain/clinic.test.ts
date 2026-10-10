import { describe, expect, it } from "vitest";
import { assertValidClinicName } from "./clinic.js";

describe("assertValidClinicName", () => {
  it("remove espaços nas pontas", () => {
    expect(assertValidClinicName("  Clínica Sol  ")).toBe("Clínica Sol");
  });

  it("recusa nome vazio ou só espaços", () => {
    expect(() => assertValidClinicName("")).toThrow();
    expect(() => assertValidClinicName("   ")).toThrow();
  });
});
