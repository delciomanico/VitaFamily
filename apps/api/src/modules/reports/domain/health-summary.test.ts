// TC-RPT-06/07 (BR-RPT-13/14/15/17): cálculo puro do Resumo de saúde.
import { describe, expect, it } from "vitest";
import { adherencePct, buildAdherenceSeries, buildExamSeries, countByMonth, countByStatus, granularityFor, missingItem, weekStart, withinNextDays, type ExamFact } from "./health-summary.js";

const exam = (examDate: string, results: { parameter: string; value: number | null; unit?: string | null; refMin?: number | null; refMax?: number | null }[]): ExamFact => ({
  examDate,
  results: results.map((r, i) => ({ parameter: r.parameter, valueNumeric: r.value, unit: r.unit ?? null, referenceMin: r.refMin ?? null, referenceMax: r.refMax ?? null, createdAt: `${examDate}T10:0${String(i)}:00Z` })),
});

describe("adesão (BR-RPT-13, AC-RPT-05)", () => {
  it.each([
    [{ taken: 6, notTaken: 2, unconfirmed: 2 }, 60],
    [{ taken: 1, notTaken: 2, unconfirmed: 0 }, 33],
    [{ taken: 2, notTaken: 1, unconfirmed: 0 }, 67],
    [{ taken: 0, notTaken: 3, unconfirmed: 0 }, 0],
    [{ taken: 0, notTaken: 0, unconfirmed: 0 }, null],
  ])("%j => %s (null com denominador 0, nunca 0 %%)", (counts, expected) => {
    expect(adherencePct(counts)).toBe(expected);
  });

  const period = { from: "2026-10-01", to: "2026-10-31" };
  const now = new Date("2026-10-20T12:00:00Z");

  it("semana (<= 90 dias) com fuso do utilizador: 23:30 UTC de domingo já é segunda em Lisboa (UTC+1 até 25/10)", () => {
    const { granularity, series } = buildAdherenceSeries([{ scheduledAt: "2026-10-11T23:30:00Z", status: "TAKEN" }], period, now, "Europe/Lisbon");
    expect(granularity).toBe("WEEK");
    expect(series.find((b) => b.periodStart === "2026-10-12")?.taken).toBe(1);
    expect(series.find((b) => b.periodStart === "2026-10-05")?.taken).toBe(0);
  });

  it("exclui futuras e PENDING; baldes vazios com null", () => {
    const { series } = buildAdherenceSeries(
      [
        { scheduledAt: "2026-10-02T08:00:00Z", status: "TAKEN" },
        { scheduledAt: "2026-10-03T08:00:00Z", status: "NOT_TAKEN" },
        { scheduledAt: "2026-10-04T08:00:00Z", status: "UNCONFIRMED" },
        { scheduledAt: "2026-10-05T08:00:00Z", status: "PENDING" },
        { scheduledAt: "2026-10-25T08:00:00Z", status: "TAKEN" },
      ],
      period,
      now,
      "UTC",
    );
    expect(series[0]).toMatchObject({ periodStart: "2026-09-28", taken: 1, notTaken: 1, unconfirmed: 1, adherencePct: 33 });
    expect(series.at(-1)).toMatchObject({ taken: 0, adherencePct: null });
  });

  it("período > 90 dias usa meses", () => {
    expect(granularityFor({ from: "2026-01-01", to: "2026-04-01" })).toBe("MONTH");
    expect(granularityFor({ from: "2026-01-01", to: "2026-03-31" })).toBe("WEEK");
    const { series } = buildAdherenceSeries([{ scheduledAt: "2026-02-10T08:00:00Z", status: "TAKEN" }], { from: "2025-11-15", to: "2026-04-01" }, now, "UTC");
    expect(series.map((b) => b.periodStart)).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
    expect(series[3]?.adherencePct).toBe(100);
  });

  it("weekStart devolve a segunda-feira", () => {
    expect(weekStart("2026-10-11")).toBe("2026-10-05");
    expect(weekStart("2026-10-12")).toBe("2026-10-12");
  });
});

describe("séries de exames (BR-RPT-14, AC-RPT-06)", () => {
  it("100, 130, 120 mg/dL: min/max/first/last/variação; texto fica fora", () => {
    const { series } = buildExamSeries([
      exam("2026-01-10", [{ parameter: "Glicose", value: 100, unit: "mg/dL" }, { parameter: "Grupo", value: null }]),
      exam("2026-04-10", [{ parameter: " glicose ", value: 130, unit: "mg/dL" }]),
      exam("2026-07-10", [{ parameter: "GLICOSE", value: 120, unit: "mg/dL", refMin: 70, refMax: 99 }]),
    ]);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({ unit: "mg/dL", count: 3, min: 100, max: 130, first: 100, last: 120, variationAbs: 20, variationPct: 20, referenceMin: 70, referenceMax: 99 });
    expect(series[0]?.points.map((p) => p.value)).toEqual([100, 130, 120]);
  });

  it("unidades diferentes dão séries separadas, sem conversão", () => {
    const { series } = buildExamSeries([exam("2026-01-10", [{ parameter: "Glicose", value: 100, unit: "mg/dL" }]), exam("2026-02-10", [{ parameter: "Glicose", value: 5.5, unit: "mmol/L" }])]);
    expect(series.map((s) => `${s.unit}:${String(s.count)}`).sort()).toEqual(["mg/dL:1", "mmol/L:1"]);
  });

  it("variationPct null com first=0 ou 1 ponto; abs null com 1 ponto", () => {
    const zero = buildExamSeries([exam("2026-01-10", [{ parameter: "X", value: 0 }]), exam("2026-02-10", [{ parameter: "X", value: 4 }])]).series[0];
    expect(zero).toMatchObject({ variationAbs: 4, variationPct: null });
    const single = buildExamSeries([exam("2026-01-10", [{ parameter: "Y", value: 3 }])]).series[0];
    expect(single).toMatchObject({ count: 1, variationAbs: null, variationPct: null });
  });

  it("variação negativa usa |first|", () => {
    const s = buildExamSeries([exam("2026-01-10", [{ parameter: "X", value: -10 }]), exam("2026-02-10", [{ parameter: "X", value: -5 }])]).series[0];
    expect(s).toMatchObject({ variationAbs: 5, variationPct: 50 });
  });

  it("corta a 20 séries (as mais recentes) e a 100 pontos (truncated), com estatística sobre tudo", () => {
    const many = Array.from({ length: 25 }, (_, i) => exam(`2026-01-${String(i + 1).padStart(2, "0")}`, [{ parameter: `P${String(i)}`, value: i }]));
    const cut = buildExamSeries(many);
    expect(cut.series).toHaveLength(20);
    expect(cut.truncated).toBe(true);
    expect(cut.series[0]?.parameter).toBe("P24");

    const dense = Array.from({ length: 120 }, (_, i) => exam(`2025-${String(1 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`, [{ parameter: "Z", value: i }]));
    const [s] = buildExamSeries(dense).series;
    expect(s).toMatchObject({ count: 120, min: 0, max: 119, first: 0, last: 119, truncated: true });
    expect(s?.points).toHaveLength(100);
    expect(buildExamSeries(dense).truncated).toBe(false);
  });

  it("nunca produz campo de juízo (BR-EXM-02)", () => {
    const json = JSON.stringify(buildExamSeries([exam("2026-01-10", [{ parameter: "X", value: 500, refMin: 1, refMax: 2 }])]));
    expect(json).not.toMatch(/outOfRange|abnormal|alert|high|low|status|flag/i);
  });
});

describe("contagens e completude", () => {
  it("por estado, por mês e próximos 30 dias", () => {
    expect(countByStatus([{ status: "SCHEDULED" }, { status: "COMPLETED" }, { status: "SCHEDULED" }])).toEqual({ SCHEDULED: 2, COMPLETED: 1 });
    expect(countByMonth(["2026-03-02", "2026-01-30", "2026-03-20"])).toEqual([{ month: "2026-01", count: 1 }, { month: "2026-03", count: 2 }]);
    expect(withinNextDays("2026-11-04", "2026-10-05", 30)).toBe(true);
    expect(withinNextDays("2026-11-05", "2026-10-05", 30)).toBe(false);
    expect(withinNextDays("2026-10-04", "2026-10-05", 30)).toBe(false);
  });

  it("missingItem: omite 0, ids só com escrita, máx. 20", () => {
    expect(missingItem("EXAM_PAST_OPEN", [], true)).toBeNull();
    expect(missingItem("EXAM_PAST_OPEN", ["a", "b"], false)).toEqual({ code: "EXAM_PAST_OPEN", count: 2 });
    const many = Array.from({ length: 30 }, (_, i) => String(i));
    expect(missingItem("EXAM_PAST_OPEN", many, true)).toMatchObject({ count: 30 });
    expect(missingItem("EXAM_PAST_OPEN", many, true)?.sourceIds).toHaveLength(20);
    expect(missingItem("BLOOD_TYPE_UNSET", [], false, 1)).toEqual({ code: "BLOOD_TYPE_UNSET", count: 1 });
  });
});
