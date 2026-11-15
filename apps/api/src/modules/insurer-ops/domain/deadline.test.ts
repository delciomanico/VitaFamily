// TC-AUT-18 (BR-AUT-06/08/14): prazos puros com o relógio injetado; os VALORES vêm de fora (política), nunca daqui.
import { describe, expect, it } from "vitest";
import { calcularLimiteInformacao, calcularLimiteRecurso, calcularPrazoDecisao, calcularValidade, isExpired } from "./deadline.js";

const NOW = new Date("2026-03-28T22:30:00Z");

describe("deadline.ts", () => {
  it.each([
    [24, "2026-03-29T22:30:00.000Z"],
    [48, "2026-03-30T22:30:00.000Z"],
    [96, "2026-04-01T22:30:00.000Z"],
  ])("calcularPrazoDecisao(%i h) = %s (horas absolutas, sem fusos)", (hours, expected) => {
    expect(calcularPrazoDecisao(NOW, hours).toISOString()).toBe(expected);
  });

  it("calcularLimiteInformacao e calcularLimiteRecurso somam dias de 24 h", () => {
    expect(calcularLimiteInformacao(NOW, 3).toISOString()).toBe("2026-03-31T22:30:00.000Z");
    expect(calcularLimiteRecurso(NOW, 20).toISOString()).toBe("2026-04-17T22:30:00.000Z");
  });

  it("é pura: não altera a data recebida", () => {
    const copy = new Date(NOW);
    calcularPrazoDecisao(NOW, 10);
    expect(NOW).toEqual(copy);
  });

  it.each([
    ["2026-11-20", 30, "2026-12-20T23:59:59.999Z"],
    ["2026-11-20", 60, "2027-01-19T23:59:59.999Z"],
    ["2026-02-27", 1, "2026-02-28T23:59:59.999Z"],
    ["2026-12-31", 1, "2027-01-01T23:59:59.999Z"],
  ])("TC-DEC-15 calcularValidade(%s + %i d) = fim do dia UTC %s", (expectedOn, days, expected) => {
    expect(calcularValidade(expectedOn, days).toISOString()).toBe(expected);
  });

  it("TC-DEC-15 expirada é derivada: validUntil < agora (nunca por estado)", () => {
    expect(isExpired(new Date("2026-11-14T09:59:59Z"), new Date("2026-11-14T10:00:00Z"))).toBe(true);
    expect(isExpired(new Date("2026-11-14T10:00:00Z"), new Date("2026-11-14T10:00:00Z"))).toBe(false);
    expect(isExpired(null, new Date())).toBe(false);
  });
});
