import { describe, expect, it } from "vitest";
import { assertValidRecordName } from "./allergy.js";

describe("assertValidRecordName (FR-HP-02)", () => {
  it("devolve o nome sem espaços nas pontas", () => {
    expect(assertValidRecordName("  Pólen  ")).toBe("Pólen");
  });

  it.each(["", "   "])("rejeita nome vazio ou só espaços (%j)", (name) => {
    expect(() => assertValidRecordName(name)).toThrow();
  });
});
