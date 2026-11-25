import { describe, expect, it } from "vitest";
import { ageBandOf, buildSummaryContext, buildSymptomsContext, isAdult, medicationLabel, type AgeBand, type SummaryFacts } from "./index.js";
import { ALARM_PATTERNS, BLOCK_PATTERNS, buildGuardrails, normalizeForMatch, GUARDRAILS_VERSION } from "./guardrails.js";

const NOW = new Date("2026-11-25T10:00:00Z");

describe("faixa etária (BR-AI-10)", () => {
  const cases: [string, AgeBand][] = [
    ["2026-06-01", "0-2"],
    ["2024-11-26", "0-2"], // 1 ano e 364 dias
    ["2023-11-25", "3-12"], // faz 3 hoje
    ["2014-11-26", "3-12"], // 11 anos
    ["2013-11-25", "13-17"], // faz 13 hoje
    ["2009-11-26", "13-17"], // 16
    ["2008-11-25", "18-39"], // faz 18 hoje
    ["1987-11-26", "18-39"], // 39
    ["1986-11-25", "40-64"], // faz 40
    ["1962-01-01", "40-64"], // 64
    ["1961-11-25", "65+"], // faz 65
  ];
  it.each(cases)("%s ⇒ %s", (birth, band) => { expect(ageBandOf(birth, NOW)).toBe(band); });
  it("adulto só aos 18", () => {
    expect(isAdult("2008-11-26", NOW)).toBe(false);
    expect(isAdult("2008-11-25", NOW)).toBe(true);
  });
});

describe("contexto minimizado (BR-AI-10)", () => {
  const facts: SummaryFacts = {
    medications: [
      { taken: 8, notTaken: 1, unconfirmed: 1, adherencePct: 80 },
      { taken: 3, notTaken: 0, unconfirmed: 0, adherencePct: 100 },
    ],
    series: [{ parameter: "Glicose", unit: "mg/dL", referenceMin: 70, referenceMax: 99, points: [{ date: "2026-10-01", value: 90 }, { date: "2026-10-31", value: 101 }] }],
    counts: { "exams.COMPLETED": 2 },
  };
  it("etiqueta medicamentos, usa dias relativos e não leva datas absolutas nem nomes", () => {
    const ctx = buildSummaryContext("40-64", facts, "2026-10-01");
    expect(ctx.adherence?.map((a) => a.label)).toEqual(["Medicamento A", "Medicamento B"]);
    expect(ctx.series?.[0]?.points).toEqual([{ dayOffset: 0, value: 90 }, { dayOffset: 30, value: 101 }]);
    const json = JSON.stringify(ctx);
    expect(json).not.toMatch(/2026-/);
    expect(ctx.counts).toEqual({ "exams.COMPLETED": 2 });
  });
  it("etiquetas para lá de Z", () => {
    expect(medicationLabel(0)).toBe("Medicamento A");
    expect(medicationLabel(25)).toBe("Medicamento Z");
    expect(medicationLabel(26)).toBe("Medicamento AA");
  });
  it("sintomas: só a faixa; com contexto, as condições (cortadas e até 20)", () => {
    expect(buildSymptomsContext("18-39", { includeContext: false, conditions: ["Asma"] })).toEqual({ ageBand: "18-39" });
    const many = Array.from({ length: 30 }, (_, i) => `C${String(i)} ${"x".repeat(100)}`);
    const ctx = buildSymptomsContext("18-39", { includeContext: true, conditions: many });
    expect(ctx.conditions).toHaveLength(20);
    expect(ctx.conditions?.every((c) => c.length <= 80)).toBe(true);
  });
});

const matches = (patterns: { pattern: string; flags: string }[], text: string): string[] =>
  patterns.filter((p) => new RegExp(p.pattern, p.flags).test(normalizeForMatch(text))).map((p) => (p as { id?: string }).id ?? p.pattern);

describe("guardrails (BR-AI-07/09): padrões compilam e apanham o que devem", () => {
  it("todos os padrões compilam com as suas flags", () => {
    for (const p of [...BLOCK_PATTERNS, ...ALARM_PATTERNS]) expect(() => new RegExp(p.pattern, p.flags)).not.toThrow();
    expect(new Set([...BLOCK_PATTERNS, ...ALARM_PATTERNS].map((p) => p.id)).size).toBe(BLOCK_PATTERNS.length + ALARM_PATTERNS.length);
  });

  const alarms = [
    "Tenho uma dor forte no peito e no braço",
    "sinto aperto no peito",
    "ESTOU COM FALTA DE AR",
    "a minha mãe tem a boca torta e a fala arrastada",
    "teve uma hemorragia depois da queda",
    "vomitou sangue",
    "desmaiou e não acorda",
    "o meu filho teve uma convulsão",
    "quero morrer",
    "pensei em suicídio",
    "a língua está inchada e a garganta a fechar",
    "bebeu veneno por engano",
    "o bebé com febre alta há horas",
    "engasgou-se com um pedaço de comida",
  ];
  it.each(alarms)("alarme: %s", (text) => { expect(matches(ALARM_PATTERNS, text).length).toBeGreaterThan(0); });

  const harmless = ["Tenho tosse seca há dois dias", "Dor de cabeça ligeira ao fim do dia", "Cansaço depois do trabalho", "A adesão desceu em outubro"];
  it.each(harmless)("sem alarme: %s", (text) => { expect(matches(ALARM_PATTERNS, text)).toEqual([]); });

  const blocked = [
    "Você tem diabetes",
    "O diagnóstico definitivo é gripe",
    "Tome um comprimido de paracetamol",
    "Deve tomar 500 mg de manhã",
    "Aumente a dose do medicamento",
    "Pare o tratamento por uns dias",
    "Eu receito um antibiótico",
    "Tome ibuprofeno se tiver dor",
    "Os valores são normais",
    "Não precisa de ir ao médico",
    "Experimente uma vitamina C e um xarope",
  ];
  it.each(blocked)("bloqueado: %s", (text) => { expect(matches(BLOCK_PATTERNS, text).length).toBeGreaterThan(0); });

  const allowed = [
    "A adesão às tomas desceu em outubro e subiu em novembro.",
    "Os sintomas podem justificar uma consulta de Medicina Geral.",
    "Beba água e descanse; procure cuidados se piorar ou se aparecer febre.",
    "O parâmetro Glicose variou entre 90 e 101 ao longo do período.",
  ];
  it.each(allowed)("permitido: %s", (text) => { expect(matches(BLOCK_PATTERNS, text)).toEqual([]); });

  it("buildGuardrails junta versão, textos e lista de especialidades", () => {
    const g = buildGuardrails([{ id: "11111111-1111-4111-8111-111111111111", name: "Cardiologia" }]);
    expect(g.version).toBe(GUARDRAILS_VERSION);
    expect(g.allowedSpecialties).toHaveLength(1);
    expect(g.disclaimer).toMatch(/não é um diagnóstico/);
    expect(g.urgencyMessage).toMatch(/urgência/);
    expect(g.responseSchema.required).toEqual(expect.arrayContaining(["summary", "urgency"]));
  });
});
