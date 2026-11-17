import { describe, expect, it } from "vitest";
import { validateOfferInput } from "./offer.js";
import { charLength } from "./text.js";

describe("charLength (pontos de código, como char_length da BD)", () => {
  it.each([
    ["", 0],
    ["abc", 3],
    ["ção", 3],
    ["😀", 1],
    ["a😀b", 3],
  ])("%j tem %i", (value, n) => {
    expect(charLength(value)).toBe(n);
  });

  it("uma nota de 200 emojis (400 unidades UTF-16) é válida; 201 é recusada", () => {
    const base = { specialtyId: "s", method: "CHAT", durationMinutes: 30, priceKz: 0 };
    expect(validateOfferInput({ ...base, note: "😀".repeat(200) }).note).toBe("😀".repeat(200));
    expect(() => validateOfferInput({ ...base, note: "😀".repeat(201) })).toThrow();
  });
});
