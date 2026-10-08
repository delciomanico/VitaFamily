import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/index.js";
import { DEFAULT_PAGE_LIMIT, parsePageParams } from "./index.js";

describe("parsePageParams", () => {
  it("usa o limite por defeito (25) quando ausente", () => {
    expect(parsePageParams()).toEqual({ limit: DEFAULT_PAGE_LIMIT });
  });

  it("aceita um limite válido dentro de 1-100", () => {
    expect(parsePageParams("10")).toEqual({ limit: 10 });
  });

  it("aceita um cursor opcional", () => {
    expect(parsePageParams("10", "abc")).toEqual({ limit: 10, cursor: "abc" });
  });

  it.each(["0", "101", "-1", "abc", "1.5"])("rejeita limit=%s com VALIDATION_ERROR", (limit) => {
    expect(() => parsePageParams(limit)).toThrow(ValidationError);
  });

  it("limite 1 e 100 são aceites (limites da gama)", () => {
    expect(parsePageParams("1").limit).toBe(1);
    expect(parsePageParams("100").limit).toBe(100);
  });
});
