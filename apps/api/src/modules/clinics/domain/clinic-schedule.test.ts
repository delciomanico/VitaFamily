// Regras puras de geração de horários, sobreposição de regras e bloqueios (M14 a2, BR-CLN-12..14, TC-CLN-05).
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import {
  assertValidTimeOffRange,
  generateRuleCandidates,
  generationWindow,
  planGeneration,
  scheduleRulesOverlap,
  slotIntersectsTimeOff,
  staleRuleSlots,
  validateRuleFields,
  type ClinicScheduleRule,
} from "./clinic-schedule.js";
import { intervalsOverlap, slotsOverlap } from "./clinic-slot.js";

const rule = (over: Partial<ClinicScheduleRule> = {}): Pick<ClinicScheduleRule, "weekdays" | "startTime" | "endTime" | "validFrom" | "validUntil"> => ({
  weekdays: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "11:00",
  validFrom: null,
  validUntil: null,
  ...over,
});

const iso = (d: Date) => d.toISOString();

describe("generateRuleCandidates (BR-CLN-12, AC-CLN-08)", () => {
  // Domingo 2026-10-11, ainda WEST (UTC+1): a janela cobre 2026-10-11 .. 2026-12-06.
  const NOW = new Date("2026-10-11T08:00:00Z");

  it("seg–sex 09:00–11:00, 30 min: 4 horários por dia útil em 8 semanas (40 dias úteis)", () => {
    const candidates = generateRuleCandidates(rule(), 30, generationWindow(NOW), NOW);
    expect(candidates).toHaveLength(160);
    expect(candidates.slice(0, 4).map((c) => iso(c.startsAt))).toEqual(["2026-10-12T08:00:00.000Z", "2026-10-12T08:30:00.000Z", "2026-10-12T09:00:00.000Z", "2026-10-12T09:30:00.000Z"]);
  });

  it("encosta consecutivos: o fim de um é o início do seguinte e o último termina em/antes de endTime", () => {
    const candidates = generateRuleCandidates(rule({ startTime: "09:00", endTime: "10:45" }), 45, generationWindow(NOW), NOW).slice(0, 2);
    expect(candidates.map((c) => [iso(c.startsAt), iso(c.endsAt)])).toEqual([
      ["2026-10-12T08:00:00.000Z", "2026-10-12T08:45:00.000Z"],
      ["2026-10-12T08:45:00.000Z", "2026-10-12T09:30:00.000Z"],
    ]);
  });

  it("ignora o passado (incluindo o instante exato de agora) e respeita validFrom/validUntil inclusivos", () => {
    const monday = new Date("2026-10-12T08:00:00Z"); // 09:00 local de segunda
    const today = generateRuleCandidates(rule({ weekdays: [1], validFrom: "2026-10-12", validUntil: "2026-10-12" }), 30, generationWindow(monday), monday);
    expect(today.map((c) => iso(c.startsAt))).toEqual(["2026-10-12T08:30:00.000Z", "2026-10-12T09:00:00.000Z", "2026-10-12T09:30:00.000Z"]);
    const bounded = generateRuleCandidates(rule({ weekdays: [1], validFrom: "2026-10-19", validUntil: "2026-10-26" }), 60, generationWindow(NOW), NOW);
    expect(bounded.map((c) => iso(c.startsAt).slice(0, 10))).toEqual(["2026-10-19", "2026-10-19", "2026-10-26", "2026-10-26"]);
  });

  it("janela: hoje inclusive até hoje + 56 dias; horizonte configurável", () => {
    const sundays = generateRuleCandidates(rule({ weekdays: [7], startTime: "10:00", endTime: "11:00" }), 60, generationWindow(NOW), NOW);
    expect(sundays.map((c) => iso(c.startsAt).slice(0, 10))).toEqual(["2026-10-11", "2026-10-18", "2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29", "2026-12-06"]);
    expect(generateRuleCandidates(rule({ weekdays: [1] }), 60, generationWindow(NOW, 1), NOW)).toHaveLength(2);
  });

  it("DST de outono (Europe/Lisbon, 25/10/2026): 00:00–03:00 locais são 4 h reais => 4 horários de 60 min, sem sobreposição", () => {
    const now = new Date("2026-10-20T08:00:00Z");
    const c = generateRuleCandidates(rule({ weekdays: [7], startTime: "00:00", endTime: "03:00", validFrom: "2026-10-25", validUntil: "2026-10-25" }), 60, generationWindow(now), now);
    expect(c.map((x) => iso(x.startsAt))).toEqual(["2026-10-24T23:00:00.000Z", "2026-10-25T00:00:00.000Z", "2026-10-25T01:00:00.000Z", "2026-10-25T02:00:00.000Z"]);
    for (let i = 1; i < c.length; i++) expect(c[i - 1]?.endsAt.getTime()).toBe(c[i]?.startsAt.getTime());
  });

  it("DST de primavera (29/03/2026): 00:00–03:00 locais são 2 h reais => 2 horários de 60 min", () => {
    const now = new Date("2026-03-20T08:00:00Z");
    const c = generateRuleCandidates(rule({ weekdays: [7], startTime: "00:00", endTime: "03:00", validFrom: "2026-03-29", validUntil: "2026-03-29" }), 60, generationWindow(now), now);
    expect(c.map((x) => iso(x.startsAt))).toEqual(["2026-03-29T00:00:00.000Z", "2026-03-29T01:00:00.000Z"]);
  });

  it("depois da mudança de hora as horas locais mantêm-se (09:00 local = 09:00Z no inverno)", () => {
    const c = generateRuleCandidates(rule({ weekdays: [1], validFrom: "2026-11-02", validUntil: "2026-11-02", startTime: "09:00", endTime: "09:30" }), 30, generationWindow(NOW), NOW);
    expect(c.map((x) => iso(x.startsAt))).toEqual(["2026-11-02T09:00:00.000Z"]);
  });
});

describe("validateRuleFields (BR-CLN-12)", () => {
  const appointment = { kind: "APPOINTMENT" as const, durationMinutes: 30 };
  const ok = { weekdays: [3, 1], startTime: "09:00", endTime: "10:00" };

  it("normaliza (dias ordenados, capacity 1)", () => {
    expect(validateRuleFields(ok, appointment)).toEqual({ weekdays: [1, 3], startTime: "09:00", endTime: "10:00", validFrom: null, validUntil: null, capacity: 1 });
  });

  it.each([
    ["dias repetidos", { ...ok, weekdays: [1, 1] }],
    ["dia 0", { ...ok, weekdays: [0] }],
    ["dia 8", { ...ok, weekdays: [8] }],
    ["sem dias", { ...ok, weekdays: [] }],
    ["fim <= início", { ...ok, endTime: "09:00" }],
    ["intervalo menor que a duração", { ...ok, endTime: "09:20" }],
    ["hora inválida", { ...ok, startTime: "9:00" }],
    ["validUntil < validFrom", { ...ok, validFrom: "2026-02-02", validUntil: "2026-02-01" }],
    ["dia inexistente", { ...ok, validFrom: "2026-02-31" }],
    ["capacity > 1 em consulta", { ...ok, capacity: 2 }],
    ["capacity 0", { ...ok, capacity: 0 }],
  ])("rejeita %s", (_name, input) => {
    expect(() => validateRuleFields(input, appointment)).toThrow(ValidationError);
  });

  it("capacity > 1 só em EXAM", () => {
    expect(validateRuleFields({ ...ok, capacity: 5 }, { kind: "EXAM", durationMinutes: 30 }).capacity).toBe(5);
  });
});

describe("scheduleRulesOverlap (BR-CLN-13)", () => {
  it.each([
    ["mesmo dia e horas sobrepostas, sem validade", rule(), rule({ startTime: "10:30", endTime: "12:00" }), true],
    ["horas encostadas (fim = início)", rule(), rule({ startTime: "11:00", endTime: "12:00" }), false],
    ["dias da semana disjuntos", rule({ weekdays: [1] }), rule({ weekdays: [2] }), false],
    ["validades disjuntas", rule({ validUntil: "2026-12-01" }), rule({ validFrom: "2026-12-02" }), false],
    ["validades que se tocam no mesmo dia (inclusivo)", rule({ validUntil: "2026-12-01" }), rule({ validFrom: "2026-12-01" }), true],
    ["uma aberta e outra limitada que cai dentro", rule(), rule({ validFrom: "2026-05-01", validUntil: "2026-05-02" }), true],
  ])("%s", (_name, a, b, expected) => {
    expect(scheduleRulesOverlap(a, b)).toBe(expected);
    expect(scheduleRulesOverlap(b, a)).toBe(expected);
  });
});

describe("planGeneration (idempotência, sobreposição e bloqueios; BR-CLN-12/13/14)", () => {
  const at = (hhmm: string) => new Date(`2026-11-02T${hhmm}:00Z`);
  const cand = (hhmm: string, min: number) => ({ startsAt: at(hhmm), endsAt: new Date(at(hhmm).getTime() + min * 60_000) });
  const candidates = [cand("09:00", 30), cand("09:30", 30), cand("10:00", 30)];

  it("sem nada existente cria todos", () => {
    expect(planGeneration("r1", candidates, [], [])).toMatchObject({ unchanged: 0, skippedOverlap: 0, skippedTimeOff: 0 });
    expect(planGeneration("r1", candidates, [], []).toCreate).toHaveLength(3);
  });

  it("segunda execução: tudo 'unchanged', nada a criar", () => {
    const existing = candidates.map((c) => ({ startsAt: c.startsAt, durationMinutes: 30, scheduleRuleId: "r1" }));
    const plan = planGeneration("r1", candidates, existing, []);
    expect(plan.toCreate).toHaveLength(0);
    expect(plan.unchanged).toBe(3);
  });

  it("sobreposição com horário manual de outra origem é ignorada (nunca falha) e consecutivos são aceites", () => {
    const manual = [{ startsAt: at("09:15"), durationMinutes: 30 }];
    const plan = planGeneration("r1", candidates, manual, []);
    expect(plan.skippedOverlap).toBe(2); // 09:00 e 09:30 sobrepõem [09:15,09:45)
    expect(plan.toCreate.map((c) => c.startsAt.toISOString())).toEqual([at("10:00").toISOString()]);
  });

  it("bloqueio tem precedência e conta à parte", () => {
    const plan = planGeneration("r1", candidates, [], [{ startsAt: at("09:30"), endsAt: at("10:00") }]);
    expect(plan.skippedTimeOff).toBe(1);
    expect(plan.toCreate).toHaveLength(2);
  });
});

describe("staleRuleSlots (BR-CLN-15)", () => {
  it("devolve só os horários da regra que já não correspondem ao previsto", () => {
    const desired = [{ startsAt: new Date("2026-11-02T09:00:00Z"), endsAt: new Date("2026-11-02T09:30:00Z") }];
    const slots = [{ startsAt: new Date("2026-11-02T09:00:00Z") }, { startsAt: new Date("2026-11-02T09:30:00Z") }];
    expect(staleRuleSlots(slots, desired)).toEqual([slots[1]]);
    expect(staleRuleSlots(slots, [])).toHaveLength(2);
  });
});

describe("intervalos semiabertos e bloqueios (BR-CLN-13/14)", () => {
  const t = (s: string) => new Date(`2026-11-02T${s}:00Z`);

  it("fim de um = início do outro NÃO sobrepõe; sobreposição parcial sim", () => {
    expect(intervalsOverlap(t("09:00"), t("09:30"), t("09:30"), t("10:00"))).toBe(false);
    expect(slotsOverlap({ startsAt: t("09:00"), durationMinutes: 30 }, { startsAt: t("09:15"), durationMinutes: 30 })).toBe(true);
    expect(slotsOverlap({ startsAt: t("09:00"), durationMinutes: 60 }, { startsAt: t("09:30"), durationMinutes: 15 })).toBe(true);
  });

  it("slotIntersectsTimeOff", () => {
    const off = { startsAt: t("09:30"), endsAt: t("10:30") };
    expect(slotIntersectsTimeOff({ startsAt: t("09:00"), durationMinutes: 30 }, off)).toBe(false);
    expect(slotIntersectsTimeOff({ startsAt: t("09:15"), durationMinutes: 30 }, off)).toBe(true);
    expect(slotIntersectsTimeOff({ startsAt: t("10:30"), durationMinutes: 30 }, off)).toBe(false);
  });
});

describe("assertValidTimeOffRange (BR-CLN-14)", () => {
  const now = new Date("2026-11-02T10:00:00Z");
  const day = 24 * 3600 * 1000;

  it("aceita um intervalo futuro de até 366 dias (e que começa no passado mas termina no futuro)", () => {
    expect(() => { assertValidTimeOffRange(new Date(now.getTime() + day), new Date(now.getTime() + 2 * day), now); }).not.toThrow();
    expect(() => { assertValidTimeOffRange(new Date(now.getTime() - day), new Date(now.getTime() + day), now); }).not.toThrow();
    expect(() => { assertValidTimeOffRange(new Date(now.getTime() + day), new Date(now.getTime() + 367 * day), now); }).not.toThrow();
  });

  it.each([
    ["fim = início", new Date(now.getTime() + day), new Date(now.getTime() + day)],
    ["fim < início", new Date(now.getTime() + 2 * day), new Date(now.getTime() + day)],
    ["mais de 366 dias", new Date(now.getTime() + day), new Date(now.getTime() + 368 * day)],
    ["fim no passado", new Date(now.getTime() - 3 * day), new Date(now.getTime() - day)],
    ["data inválida", new Date("x"), new Date(now.getTime() + day)],
  ])("rejeita %s", (_name, startsAt, endsAt) => {
    expect(() => { assertValidTimeOffRange(startsAt, endsAt, now); }).toThrow(ValidationError);
  });
});
