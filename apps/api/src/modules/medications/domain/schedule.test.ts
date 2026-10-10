// TC-MED-01/TC-MED-02 (test-cases.md): geração FIXED_TIMES/INTERVAL; DST (hora inexistente em
// março, hora repetida em outubro) em Europe/Lisbon — casos fixos (strategy.md §"DST e fusos").
import { describe, expect, it } from "vitest";
import {
  addCalendarDays,
  generateOccurrences,
  isValidTimeOfDay,
  isoWeekday,
  localDateTimeOf,
  zonedTimeToUtc,
  type FixedTimesSchedule,
  type IntervalSchedule,
} from "./schedule.js";

const LISBON = "Europe/Lisbon";

describe("zonedTimeToUtc (DST, Europe/Lisbon)", () => {
  it("hora normal (sem DST a meio do inverno)", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 1, day: 15, hour: 10, minute: 0 }, LISBON);
    expect(result.kind).toBe("UNAMBIGUOUS");
    expect(result.utc.toISOString()).toBe("2026-01-15T10:00:00.000Z");
  });

  it("hora normal em verão (WEST, UTC+1)", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 7, day: 15, hour: 13, minute: 0 }, LISBON);
    expect(result.kind).toBe("UNAMBIGUOUS");
    expect(result.utc.toISOString()).toBe("2026-07-15T12:00:00.000Z");
  });

  it("TC-MED-02: hora inexistente (último domingo de março, salto 01:00->02:00) avança para a hora válida seguinte", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, LISBON);
    expect(result.kind).toBe("GAP");
    // 01:30 não existe; a hora local que o instante devolvido representa é 02:30 WEST.
    expect(localDateTimeOf(result.utc, LISBON)).toEqual({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 });
  });

  it("imediatamente antes do salto de março continua inequívoco", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 0, minute: 30 }, LISBON);
    expect(result.kind).toBe("UNAMBIGUOUS");
    expect(result.utc.toISOString()).toBe("2026-03-29T00:30:00.000Z");
  });

  it("imediatamente depois do salto de março continua inequívoco", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, LISBON);
    expect(result.kind).toBe("UNAMBIGUOUS");
    expect(result.utc.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });

  it("TC-MED-02: hora repetida (último domingo de outubro, recuo 02:00->01:00) devolve a primeira ocorrência", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, LISBON);
    expect(result.kind).toBe("AMBIGUOUS");
    // Primeira ocorrência: ainda em WEST (UTC+1) -> 00:30 UTC (mais cedo que a segunda, em WET, 01:30 UTC).
    expect(result.utc.toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });

  it("antes e depois do recuo de outubro continuam inequívocos", () => {
    const before = zonedTimeToUtc({ year: 2026, month: 10, day: 25, hour: 0, minute: 30 }, LISBON);
    const after = zonedTimeToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, LISBON);
    expect(before.kind).toBe("UNAMBIGUOUS");
    expect(after.kind).toBe("UNAMBIGUOUS");
    expect(before.utc.toISOString()).toBe("2026-10-24T23:30:00.000Z");
    expect(after.utc.toISOString()).toBe("2026-10-25T02:30:00.000Z");
  });

  it("funciona também para UTC (sem DST)", () => {
    const result = zonedTimeToUtc({ year: 2026, month: 3, day: 29, hour: 1, minute: 30 }, "UTC");
    expect(result.kind).toBe("UNAMBIGUOUS");
    expect(result.utc.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
});

describe("addCalendarDays/isoWeekday", () => {
  it("soma dias através de limites de mês/ano", () => {
    expect(addCalendarDays({ year: 2026, month: 2, day: 27 }, 3)).toEqual({ year: 2026, month: 3, day: 2 });
    expect(addCalendarDays({ year: 2026, month: 12, day: 31 }, 1)).toEqual({ year: 2027, month: 1, day: 1 });
  });

  it("dia da semana ISO (1=segunda..7=domingo)", () => {
    // 2026-01-15 é quinta-feira.
    expect(isoWeekday({ year: 2026, month: 1, day: 15 })).toBe(4);
    // 2026-01-18 é domingo.
    expect(isoWeekday({ year: 2026, month: 1, day: 18 })).toBe(7);
  });
});

describe("isValidTimeOfDay", () => {
  it.each(["00:00", "08:30", "23:59"])("aceita %s", (value) => {
    expect(isValidTimeOfDay(value)).toBe(true);
  });

  it.each(["24:00", "8:30", "08:60", "abc", ""])("rejeita %s", (value) => {
    expect(isValidTimeOfDay(value)).toBe(false);
  });
});

describe("generateOccurrences (AC-MED-01)", () => {
  it("FIXED_TIMES: gera nos horários locais do fuso efetivo, dentro da janela", () => {
    const schedule: FixedTimesSchedule = { scheduleType: "FIXED_TIMES", times: ["08:00", "20:00"], daysOfWeek: [] };
    const window = { from: new Date("2026-01-15T00:00:00.000Z"), to: new Date("2026-01-16T23:59:59.999Z") };
    const occurrences = generateOccurrences(schedule, window, window.from, null, LISBON);
    expect(occurrences.map((d) => d.toISOString())).toEqual([
      "2026-01-15T08:00:00.000Z",
      "2026-01-15T20:00:00.000Z",
      "2026-01-16T08:00:00.000Z",
      "2026-01-16T20:00:00.000Z",
    ]);
  });

  it("FIXED_TIMES: respeita daysOfWeek (só às terças e quintas)", () => {
    // 2026-01-13 = terça, 2026-01-15 = quinta.
    const schedule: FixedTimesSchedule = { scheduleType: "FIXED_TIMES", times: ["09:00"], daysOfWeek: [2, 4] };
    const window = { from: new Date("2026-01-12T00:00:00.000Z"), to: new Date("2026-01-18T23:59:59.999Z") };
    const occurrences = generateOccurrences(schedule, window, window.from, null, LISBON);
    expect(occurrences.map((d) => d.toISOString())).toEqual(["2026-01-13T09:00:00.000Z", "2026-01-15T09:00:00.000Z"]);
  });

  it("FIXED_TIMES: nunca excede a vigência do plano (endAt)", () => {
    const schedule: FixedTimesSchedule = { scheduleType: "FIXED_TIMES", times: ["08:00"], daysOfWeek: [] };
    const window = { from: new Date("2026-01-15T00:00:00.000Z"), to: new Date("2026-01-20T23:59:59.999Z") };
    const planEnd = new Date("2026-01-16T10:00:00.000Z");
    const occurrences = generateOccurrences(schedule, window, window.from, planEnd, LISBON);
    expect(occurrences.map((d) => d.toISOString())).toEqual(["2026-01-15T08:00:00.000Z", "2026-01-16T08:00:00.000Z"]);
  });

  it("FIXED_TIMES atravessa o salto de março sem perder nem duplicar doses", () => {
    const schedule: FixedTimesSchedule = { scheduleType: "FIXED_TIMES", times: ["01:30"], daysOfWeek: [] };
    const window = { from: new Date("2026-03-28T00:00:00.000Z"), to: new Date("2026-03-30T23:59:59.999Z") };
    const occurrences = generateOccurrences(schedule, window, window.from, null, LISBON);
    // 3 dias, 3 ocorrências (28, 29 "saltada" para 02:30 local, 30) — nunca perde nem duplica.
    expect(occurrences).toHaveLength(3);
    const [, saltedOccurrence] = occurrences;
    if (!saltedOccurrence) {
      throw new Error("ocorrência esperada");
    }
    expect(localDateTimeOf(saltedOccurrence, LISBON)).toEqual({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 });
  });

  it("INTERVAL: intervalos absolutos a partir de startAt, sem efeito de fuso", () => {
    const schedule: IntervalSchedule = { scheduleType: "INTERVAL", intervalHours: 8, startAt: new Date("2026-01-15T06:00:00.000Z") };
    const window = { from: new Date("2026-01-15T00:00:00.000Z"), to: new Date("2026-01-15T23:59:59.999Z") };
    const occurrences = generateOccurrences(schedule, window, schedule.startAt, null, LISBON);
    expect(occurrences.map((d) => d.toISOString())).toEqual([
      "2026-01-15T06:00:00.000Z",
      "2026-01-15T14:00:00.000Z",
      "2026-01-15T22:00:00.000Z",
    ]);
  });

  it("INTERVAL atravessa o salto de outubro sem alterar os intervalos (absoluto)", () => {
    const schedule: IntervalSchedule = { scheduleType: "INTERVAL", intervalHours: 6, startAt: new Date("2026-10-24T22:00:00.000Z") };
    const window = { from: new Date("2026-10-24T00:00:00.000Z"), to: new Date("2026-10-26T00:00:00.000Z") };
    const occurrences = generateOccurrences(schedule, window, schedule.startAt, null, LISBON);
    const times = occurrences.map((d) => d.getTime());
    const deltas = times.slice(1).map((time, i) => time - (times[i] ?? time));
    expect(deltas.every((ms) => ms === 6 * 60 * 60 * 1000)).toBe(true);
  });

  it("devolve vazio quando a janela não intersecta a vigência do plano", () => {
    const schedule: FixedTimesSchedule = { scheduleType: "FIXED_TIMES", times: ["08:00"], daysOfWeek: [] };
    const window = { from: new Date("2026-02-01T00:00:00.000Z"), to: new Date("2026-02-14T23:59:59.999Z") };
    const planEnd = new Date("2026-01-01T00:00:00.000Z");
    expect(generateOccurrences(schedule, window, window.from, planEnd, LISBON)).toEqual([]);
  });
});
