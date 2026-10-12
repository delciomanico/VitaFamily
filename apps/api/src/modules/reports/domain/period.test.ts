import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { resolvePeriod } from "./period.js";

describe("resolvePeriod (Q11/BR-RPT-02)", () => {
  it("por defeito: últimos 12 meses até hoje", () => {
    expect(resolvePeriod(undefined, undefined, "2026-10-12")).toEqual({ from: "2025-10-12", to: "2026-10-12" });
  });

  it("respeita os limites pedidos", () => {
    expect(resolvePeriod("2024-01-01", "2024-06-30", "2026-10-12")).toEqual({ from: "2024-01-01", to: "2024-06-30" });
  });

  it("ajusta ao último dia do mês ao recuar 12 meses", () => {
    expect(resolvePeriod(undefined, "2024-02-29", "2026-10-12").from).toBe("2023-02-28");
  });

  it.each([
    ["from depois de to", "2026-05-01", "2026-01-01"],
    ["mais de 5 anos", "2020-01-01", "2026-01-01"],
    ["data inexistente", "2026-02-30", "2026-03-01"],
    ["formato inválido", "01/01/2026", "2026-03-01"],
  ])("rejeita: %s", (_name, from, to) => {
    expect(() => resolvePeriod(from, to, "2026-10-12")).toThrow(ValidationError);
  });
});
