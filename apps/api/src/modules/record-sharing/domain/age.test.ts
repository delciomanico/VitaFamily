// Domínio de `record-sharing`: idade em anos completos e dia civil em `Africa/Luanda` (UTC+1 fixo; TC-MKT-142 parte U; OP-119, BR-MKT-68).
import { describe, expect, it } from "vitest";
import { computeAgeYears, luandaDay, luandaDayMonthsAgo, parseCivilDate } from "./age.js";

const ms = (iso: string): number => Date.parse(iso);

describe("computeAgeYears (Luanda UTC+1)", () => {
  describe("aniversário", () => {
    it("completa anos à meia-noite local do dia de aniversário", () => {
      expect(computeAgeYears("2000-03-10", ms("2031-03-10T00:00:00+01:00"))).toBe(31);
    });

    it("1 ms antes do instante local de aniversário ainda não completou", () => {
      expect(computeAgeYears("2000-03-10", ms("2031-03-10T00:00:00+01:00") - 1)).toBe(30);
    });

    it("2031-03-09T23:00:00Z já é 10 de março em Luanda", () => {
      expect(computeAgeYears("2000-03-10", ms("2031-03-09T23:00:00Z"))).toBe(31);
    });

    it("2031-03-09T22:59:59.999Z ainda é 9 de março em Luanda", () => {
      expect(computeAgeYears("2000-03-10", ms("2031-03-09T22:59:59.999Z"))).toBe(30);
    });
  });

  describe("nascido em 29 de fevereiro", () => {
    it("em 2031 (não bissexto) faz anos a 1 de março", () => {
      expect(computeAgeYears("2000-02-29", ms("2031-02-28T12:00:00Z"))).toBe(30);
      expect(computeAgeYears("2000-02-29", ms("2031-03-01T12:00:00Z"))).toBe(31);
    });

    it("em 2032 (bissexto) faz anos a 29 de fevereiro", () => {
      expect(computeAgeYears("2000-02-29", ms("2032-02-28T12:00:00Z"))).toBe(31);
      expect(computeAgeYears("2000-02-29", ms("2032-02-29T12:00:00Z"))).toBe(32);
    });
  });

  describe("casos limite", () => {
    it("recém-nascido (nascido no próprio dia) tem 0 anos", () => {
      expect(computeAgeYears("2031-03-10", ms("2031-03-10T12:00:00Z"))).toBe(0);
    });

    it("data de nascimento futura devolve 0 (nunca negativa)", () => {
      expect(computeAgeYears("2031-06-01", ms("2031-03-10T12:00:00Z"))).toBe(0);
    });

    it("texto que não é AAAA-MM-DD devolve null", () => {
      expect(computeAgeYears("abc", ms("2031-03-10T12:00:00Z"))).toBeNull();
      expect(computeAgeYears("2000/01/01", ms("2031-03-10T12:00:00Z"))).toBeNull();
    });

    it("parseCivilDate rejeita formatos que não são AAAA-MM-DD", () => {
      expect(parseCivilDate("abc")).toBeNull();
      expect(parseCivilDate("2000/01/01")).toBeNull();
      expect(parseCivilDate("2000-03-10")).toEqual({ year: 2000, month: 3, day: 10 });
    });
  });
});

describe("luandaDay", () => {
  it("usa o dia civil de Luanda, não o UTC (23:30Z de 31 dez ⇒ 1 jan)", () => {
    expect(luandaDay(ms("2031-12-31T23:30:00Z"))).toBe("2032-01-01");
  });
});

describe("luandaDayMonthsAgo (janela de 24 meses)", () => {
  it("recua 24 meses no mesmo dia e mês", () => {
    expect(luandaDayMonthsAgo(ms("2031-03-10T12:00:00Z"), 24)).toBe("2029-03-10");
  });

  it("ajusta 29 de fevereiro ao fim de fevereiro quando o destino não é bissexto", () => {
    expect(luandaDayMonthsAgo(ms("2032-02-29T12:00:00Z"), 24)).toBe("2030-02-28");
  });

  it("cruza o ano em janeiro (24 meses)", () => {
    expect(luandaDayMonthsAgo(ms("2031-01-15T12:00:00Z"), 24)).toBe("2029-01-15");
  });

  it("cruza o ano com 14 meses (fevereiro ⇒ dezembro do ano anterior)", () => {
    expect(luandaDayMonthsAgo(ms("2031-02-10T12:00:00Z"), 14)).toBe("2029-12-10");
  });
});
