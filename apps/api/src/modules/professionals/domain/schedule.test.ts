// Testes unitários dos horários, geração idempotente, bloqueios e regras (TC-MKT-25, BR-MKT-25/31). Sem I/O.
// Fuso fixo Africa/Luanda = UTC+1 sem DST: 08:00 locais = 07:00Z.
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import {
  assertValidTimeOffRange,
  generateRuleCandidates,
  generationWindow,
  isoWeekday,
  luandaToUtc,
  luandaToday,
  normalizeTimeOffReason,
  planGeneration,
  rulesOverlap,
  staleRuleSlots,
  validateRuleFields,
  type CandidateSlot,
  type GenerationWindow,
  type ScheduleRuleFields,
} from "./schedule.js";

const NOW = new Date("2026-11-16T10:00:00Z");
/** Terça-feira 2026-11-17 (dia útil completo). */
const TUESDAY = "2026-11-17";
const ONE_DAY_WINDOW: GenerationWindow = { firstDay: TUESDAY, lastDay: TUESDAY };
const FULL_WINDOW = generationWindow(NOW);

/** Captura o erro lançado por `fn` (falha o teste se não lançar). */
function captureError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("esperava-se um erro");
}

function expectInvalidField(fn: () => unknown, field: string): void {
  expect(captureError(fn)).toMatchObject({ code: "VALIDATION_ERROR", fields: [{ field }] });
}

/** Regra de referência: seg–sex 08:00–12:00, sem validade. */
function rule(overrides: Partial<ScheduleRuleFields> = {}): ScheduleRuleFields {
  return { weekdays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "12:00", validFrom: null, validUntil: null, ...overrides };
}

/** Dia civil de Luanda de um horário gerado (UTC+1 fixo). */
function luandaDay(slot: CandidateSlot): string {
  return new Date(slot.startsAt.getTime() + 3_600_000).toISOString().slice(0, 10);
}

function countByDay(slots: CandidateSlot[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const slot of slots) {
    const day = luandaDay(slot);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return counts;
}

describe("conversão de fuso (BR-MKT-31)", () => {
  it("08:00 de Luanda é 07:00Z", () => {
    expect(luandaToUtc("2026-11-16", "08:00").toISOString()).toBe("2026-11-16T07:00:00.000Z");
  });

  it("00:30 de Luanda recua para o dia anterior em UTC", () => {
    expect(luandaToUtc("2026-11-16", "00:30").toISOString()).toBe("2026-11-15T23:30:00.000Z");
  });

  it("luandaToday usa o dia civil de Luanda (00:30 locais já é o dia seguinte em UTC)", () => {
    expect(luandaToday(new Date("2026-11-15T23:30:00Z"))).toBe("2026-11-16");
    expect(luandaToday(NOW)).toBe("2026-11-16");
  });

  it.each([
    ["2026-11-16", 1],
    ["2026-11-17", 2],
    ["2026-11-21", 6],
    ["2026-11-22", 7],
  ] as const)("isoWeekday(%s) = %s", (day, weekday) => {
    expect(isoWeekday(day)).toBe(weekday);
  });
});

describe("validateRuleFields (BR-MKT-25)", () => {
  const valid = { weekdays: [5, 1], startTime: "08:00", endTime: "12:00" };

  it("aceita uma regra válida e ordena os dias da semana", () => {
    expect(validateRuleFields(valid, 30)).toEqual({ weekdays: [1, 5], startTime: "08:00", endTime: "12:00", validFrom: null, validUntil: null });
  });

  it.each([
    ["lista vazia", []],
    ["dia 0", [0]],
    ["dia 8", [8]],
    ["dia fracionário", [1.5]],
    ["dias repetidos", [1, 1]],
    ["mais de 7 dias", [1, 2, 3, 4, 5, 6, 7, 1]],
    ["não é array", "1"],
  ])("recusa weekdays: %s", (_label, weekdays) => {
    expectInvalidField(() => validateRuleFields({ ...valid, weekdays }, 30), "weekdays");
  });

  it.each([
    ["hora sem zero à esquerda", "8:00"],
    ["hora 24:00", "24:00"],
    ["minutos 60", "08:60"],
    ["texto", "manhã"],
  ])("recusa startTime com formato inválido (%s)", (_label, startTime) => {
    expectInvalidField(() => validateRuleFields({ ...valid, startTime }, 30), "startTime");
  });

  it("recusa endTime com formato inválido", () => {
    expectInvalidField(() => validateRuleFields({ ...valid, endTime: "12:0" }, 30), "endTime");
  });

  it.each([
    ["fim igual ao início", "08:00"],
    ["fim antes do início", "07:30"],
  ])("recusa intervalo com %s", (_label, endTime) => {
    expectInvalidField(() => validateRuleFields({ ...valid, startTime: "08:00", endTime }, 30), "endTime");
  });

  it("recusa intervalo menor que a duração da oferta e aceita intervalo igual à duração", () => {
    const short = { weekdays: [1], startTime: "08:00", endTime: "08:20" };
    expectInvalidField(() => validateRuleFields(short, 30), "endTime");
    expect(validateRuleFields(short, 20).endTime).toBe("08:20");
  });

  it("recusa data inexistente 2026-02-31 em validFrom", () => {
    expectInvalidField(() => validateRuleFields({ ...valid, validFrom: "2026-02-31" }, 30), "validFrom");
  });

  it("recusa validUntil anterior a validFrom", () => {
    expectInvalidField(() => validateRuleFields({ ...valid, validFrom: "2026-11-20", validUntil: "2026-11-19" }, 30), "validUntil");
  });

  it("aceita validUntil igual a validFrom", () => {
    expect(validateRuleFields({ ...valid, validFrom: "2026-11-20", validUntil: "2026-11-20" }, 30)).toMatchObject({
      validFrom: "2026-11-20",
      validUntil: "2026-11-20",
    });
  });
});

describe("rulesOverlap (BR-MKT-25)", () => {
  it("dias da semana disjuntos não sobrepõem", () => {
    expect(rulesOverlap(rule({ weekdays: [1] }), rule({ weekdays: [2] }))).toBe(false);
  });

  it("horas encostadas (12:00 fim e 12:00 início) não sobrepõem", () => {
    expect(rulesOverlap(rule({ startTime: "08:00", endTime: "12:00" }), rule({ startTime: "12:00", endTime: "13:00" }))).toBe(false);
  });

  it("horas parcialmente sobrepostas sobrepõem", () => {
    expect(rulesOverlap(rule({ startTime: "08:00", endTime: "12:00" }), rule({ startTime: "11:00", endTime: "13:00" }))).toBe(true);
  });

  it("validades disjuntas não sobrepõem", () => {
    const a = rule({ validFrom: "2026-11-01", validUntil: "2026-11-20" });
    const b = rule({ validFrom: "2026-11-21", validUntil: "2026-12-31" });
    expect(rulesOverlap(a, b)).toBe(false);
    expect(rulesOverlap(b, a)).toBe(false);
  });

  it("validades que se tocam no mesmo dia sobrepõem", () => {
    const a = rule({ validFrom: "2026-11-01", validUntil: "2026-11-20" });
    const b = rule({ validFrom: "2026-11-20", validUntil: "2026-12-31" });
    expect(rulesOverlap(a, b)).toBe(true);
  });

  it("null significa aberto: sem validade é sempre sobreposição com outra regra", () => {
    expect(rulesOverlap(rule(), rule({ validFrom: "2030-01-01" }))).toBe(true);
    expect(rulesOverlap(rule({ validUntil: "2026-11-20" }), rule({ validFrom: "2026-12-01" }))).toBe(false);
    expect(rulesOverlap(rule({ validFrom: null, validUntil: "2026-11-20" }), rule({ validFrom: "2026-11-21", validUntil: null }))).toBe(false);
  });

  it.each([
    ["mesmos dias e horas", rule(), rule(), true],
    ["dias partilhados e horas sobrepostas", rule({ weekdays: [1, 2] }), rule({ weekdays: [2, 3], startTime: "09:00" }), true],
    ["dias disjuntos", rule({ weekdays: [6] }), rule({ weekdays: [7] }), false],
    ["horas encostadas", rule({ endTime: "10:00" }), rule({ startTime: "10:00", endTime: "11:00" }), false],
  ] as const)("é simétrica (%s)", (_label, a, b, expected) => {
    expect(rulesOverlap(a, b)).toBe(expected);
    expect(rulesOverlap(b, a)).toBe(expected);
  });
});

describe("generationWindow (BR-MKT-25)", () => {
  it("janela rolante de 8 semanas: de hoje (Luanda) até hoje + 56 dias", () => {
    expect(generationWindow(NOW)).toEqual({ firstDay: "2026-11-16", lastDay: "2027-01-11" });
  });
});

describe("generateRuleCandidates (TC-MKT-25)", () => {
  it("08:00–12:00 seg–sex com 30 minutos gera 8 horários por dia útil", () => {
    const slots = generateRuleCandidates(rule(), 30, ONE_DAY_WINDOW, NOW);
    expect(slots).toHaveLength(8);
    expect(slots[0]?.startsAt.toISOString()).toBe("2026-11-17T07:00:00.000Z");
    expect(slots[7]?.startsAt.toISOString()).toBe("2026-11-17T10:30:00.000Z");
    expect(slots[7]?.endsAt.toISOString()).toBe("2026-11-17T11:00:00.000Z");
  });

  it("cada horário dura exatamente a duração e são consecutivos", () => {
    const slots = generateRuleCandidates(rule(), 30, ONE_DAY_WINDOW, NOW);
    for (const [index, slot] of slots.entries()) {
      expect(slot.endsAt.getTime() - slot.startsAt.getTime()).toBe(30 * 60_000);
      if (index > 0) expect(slot.startsAt.getTime()).toBe(slots[index - 1]?.endsAt.getTime());
    }
  });

  it("a janela de 8 semanas gera só em dias úteis: 1 horário hoje (já a meio da manhã) e 8 nos seguintes", () => {
    const slots = generateRuleCandidates(rule(), 30, FULL_WINDOW, NOW);
    const counts = countByDay(slots);
    expect(counts.get("2026-11-16")).toBe(1);
    expect(counts.get("2026-11-17")).toBe(8);
    expect(counts.get("2026-11-20")).toBe(8);
    expect(counts.has("2026-11-21")).toBe(false);
    expect(counts.has("2026-11-22")).toBe(false);
    expect(counts.get("2026-11-23")).toBe(8);
    expect(counts.has("2026-11-28")).toBe(false);
    expect(counts.size).toBe(41);
    expect(slots).toHaveLength(321);
  });

  it("a última data gerada é o dia de fim da janela (hoje + 56) e não há nada depois", () => {
    const slots = generateRuleCandidates(rule(), 30, FULL_WINDOW, NOW);
    const days = [...countByDay(slots).keys()].sort();
    expect(days.at(-1)).toBe("2027-01-11");
    expect(days.some((day) => day > "2027-01-11")).toBe(false);
  });

  it("não gera horários no passado nem o que começa exatamente em 'agora'", () => {
    const slots = generateRuleCandidates(rule(), 30, { firstDay: "2026-11-16", lastDay: "2026-11-16" }, NOW);
    expect(slots.map((s) => s.startsAt.toISOString())).toEqual(["2026-11-16T10:30:00.000Z"]);
  });

  it("respeita validFrom e validUntil (seg 20 a ter 24 com validade = 3 dias úteis)", () => {
    const slots = generateRuleCandidates(rule({ validFrom: "2026-11-20", validUntil: "2026-11-24" }), 30, FULL_WINDOW, NOW);
    expect([...countByDay(slots).keys()].sort()).toEqual(["2026-11-20", "2026-11-23", "2026-11-24"]);
    expect(slots).toHaveLength(24);
  });

  it("regra de domingo e segunda com validade que atravessa a virada de semana gera os dois dias", () => {
    const slots = generateRuleCandidates(
      rule({ weekdays: [7, 1], startTime: "08:00", endTime: "09:00", validFrom: "2026-11-22", validUntil: "2026-11-23" }),
      30,
      FULL_WINDOW,
      NOW,
    );
    expect(slots.map(luandaDay)).toEqual(["2026-11-22", "2026-11-22", "2026-11-23", "2026-11-23"]);
  });

  it("nenhum horário é gerado se a regra não tem dias na janela", () => {
    expect(generateRuleCandidates(rule({ weekdays: [6] }), 30, { firstDay: TUESDAY, lastDay: TUESDAY }, NOW)).toEqual([]);
  });
});

describe("planGeneration (idempotência, bloqueios, sobreposições)", () => {
  const candidates = generateRuleCandidates(rule(), 30, ONE_DAY_WINDOW, NOW);

  it("a primeira execução cria os 8 horários", () => {
    const plan = planGeneration("rule-1", candidates, [], []);
    expect(plan.toCreate).toHaveLength(8);
    expect(plan).toMatchObject({ unchanged: 0, skippedOverlap: 0, skippedTimeOff: 0 });
  });

  it("segunda execução com os criados como existentes não cria nada e marca 8 inalterados", () => {
    const first = planGeneration("rule-1", candidates, [], []);
    const existing = first.toCreate.map((slot) => ({ ...slot, ruleId: "rule-1" }));
    const second = planGeneration("rule-1", candidates, existing, []);
    expect(second.toCreate).toHaveLength(0);
    expect(second).toMatchObject({ unchanged: 8, skippedOverlap: 0, skippedTimeOff: 0 });
  });

  it("horários em bloqueio contam como skippedTimeOff (09:00–10:00Z: 2 horários)", () => {
    const timeOff = [{ startsAt: new Date("2026-11-17T09:00:00Z"), endsAt: new Date("2026-11-17T10:00:00Z") }];
    const plan = planGeneration("rule-1", candidates, [], timeOff);
    expect(plan).toMatchObject({ skippedTimeOff: 2, skippedOverlap: 0 });
    expect(plan.toCreate).toHaveLength(6);
  });

  it("horário que sobrepõe outro horário do profissional (de outra regra) conta como skippedOverlap", () => {
    // 08:45Z–09:15Z sobrepõe 08:30Z–09:00Z e 09:00Z–09:30Z.
    const existing = [{ ruleId: "rule-2", startsAt: new Date("2026-11-17T08:45:00Z"), endsAt: new Date("2026-11-17T09:15:00Z") }];
    const plan = planGeneration("rule-1", candidates, existing, []);
    expect(plan).toMatchObject({ skippedOverlap: 2, skippedTimeOff: 0 });
    expect(plan.toCreate).toHaveLength(6);
  });

  it("bloqueio tem prioridade sobre sobreposição", () => {
    const existing = [{ ruleId: "rule-2", startsAt: new Date("2026-11-17T07:00:00Z"), endsAt: new Date("2026-11-17T07:30:00Z") }];
    const timeOff = [{ startsAt: new Date("2026-11-17T07:00:00Z"), endsAt: new Date("2026-11-17T07:30:00Z") }];
    expect(planGeneration("rule-1", candidates, existing, timeOff)).toMatchObject({ skippedTimeOff: 1, skippedOverlap: 0 });
  });
});

describe("staleRuleSlots", () => {
  it("devolve os horários futuros da regra que já não correspondem ao previsto", () => {
    const future = [
      { id: "a", startsAt: new Date("2026-11-17T07:00:00Z") },
      { id: "b", startsAt: new Date("2026-11-17T07:30:00Z") },
    ];
    const desired: CandidateSlot[] = [{ startsAt: new Date("2026-11-17T07:00:00Z"), endsAt: new Date("2026-11-17T07:30:00Z") }];
    expect(staleRuleSlots(future, desired).map((s) => s.id)).toEqual(["b"]);
  });

  it("sem horários previstos, todos são obsoletos", () => {
    const future = [{ id: "a", startsAt: new Date("2026-11-17T07:00:00Z") }];
    expect(staleRuleSlots(future, [])).toEqual(future);
  });
});

describe("assertValidTimeOffRange (BR-MKT-25, UC-MKT-09)", () => {
  const start = new Date("2026-11-20T00:00:00Z");

  it("aceita um intervalo futuro válido", () => {
    expect(() => { assertValidTimeOffRange(start, new Date("2026-11-21T00:00:00Z"), NOW); }).not.toThrow();
  });

  it("aceita exatamente 366 dias", () => {
    const end = new Date(start.getTime() + 366 * 86_400_000);
    expect(() => { assertValidTimeOffRange(start, end, NOW); }).not.toThrow();
  });

  it("recusa mais de 366 dias", () => {
    const end = new Date(start.getTime() + 367 * 86_400_000);
    expectInvalidField(() => { assertValidTimeOffRange(start, end, NOW); }, "endsAt");
  });

  it.each([
    ["fim igual ao início", new Date("2026-11-20T00:00:00Z")],
    ["fim antes do início", new Date("2026-11-19T00:00:00Z")],
  ])("recusa %s", (_label, end) => {
    expectInvalidField(() => { assertValidTimeOffRange(start, end, NOW); }, "endsAt");
  });

  it("recusa intervalo que já terminou", () => {
    expectInvalidField(() => { assertValidTimeOffRange(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-10T00:00:00Z"), NOW); }, "endsAt");
  });

  it("recusa datas inválidas", () => {
    expectInvalidField(() => { assertValidTimeOffRange(new Date("invalido"), new Date("2026-11-21T00:00:00Z"), NOW); }, "startsAt");
    expectInvalidField(() => { assertValidTimeOffRange(start, new Date("invalido"), NOW); }, "startsAt");
  });

  it("lança ValidationError (VALIDATION_ERROR)", () => {
    expect(captureError(() => { assertValidTimeOffRange(start, start, NOW); })).toBeInstanceOf(ValidationError);
  });
});

describe("normalizeTimeOffReason", () => {
  it.each([undefined, null, "", "   "])("devolve null para %j", (value) => {
    expect(normalizeTimeOffReason(value)).toBeNull();
  });

  it("apara o motivo", () => {
    expect(normalizeTimeOffReason("  Férias  ")).toBe("Férias");
  });

  it("aceita exatamente 200 caracteres e recusa 201", () => {
    expect(normalizeTimeOffReason("a".repeat(200))).toBe("a".repeat(200));
    expectInvalidField(() => normalizeTimeOffReason("a".repeat(201)), "reason");
  });

  it.each([42, {}, ["x"]])("recusa valor não textual %j", (value) => {
    expectInvalidField(() => normalizeTimeOffReason(value), "reason");
  });
});
