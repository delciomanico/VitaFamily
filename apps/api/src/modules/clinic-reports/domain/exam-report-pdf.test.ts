// AC-CLN-33 / TC-CLN-24 (BR-CLN-48, emenda estreita a BR-EXM-02): realce ARITMÉTICO "Fora da referência" — comparação estrita,
// igual ao limite = dentro; só numéricos com pelo menos um limite; único rótulo; contagem (nunca quais) para a auditoria.
import { describe, expect, it } from "vitest";
import { buildExamReportDocument, EXAM_REPORT_DISCLAIMER, formatReference, isOutOfReference, OUT_OF_REFERENCE_LABEL } from "./exam-report-pdf.js";

describe("isOutOfReference (valor < min || valor > max, estrito)", () => {
  it.each([
    [11.99, 12, 16, true],
    [12, 12, 16, false],
    [14, 12, 16, false],
    [16, 12, 16, false],
    [16.01, 12, 16, true],
    [5, 12, undefined, true],
    [12, 12, undefined, false],
    [20, undefined, 16, true],
    [16, undefined, 16, false],
    [-1, 0, 10, true],
    [0, 0, 0, false],
    [0.1, 0, 0, true],
    [99, undefined, undefined, false],
    [99, null, null, false],
  ])("valor %s, min %s, max %s => %s", (valueNumeric, referenceMin, referenceMax, expected) => {
    expect(isOutOfReference({ valueNumeric, referenceMin, referenceMax })).toBe(expected);
  });

  it("resultado só de texto ou sem valor numérico nunca é realçado", () => {
    expect(isOutOfReference({ referenceMin: 1, referenceMax: 2 })).toBe(false);
    expect(isOutOfReference({ valueNumeric: null, referenceMin: 1, referenceMax: 2 })).toBe(false);
  });
});

describe("formatReference", () => {
  it.each([
    [12, 16, "12 – 16"],
    [12, undefined, "≥ 12"],
    [undefined, 16, "≤ 16"],
    [undefined, undefined, "—"],
    [0, 0, "0 – 0"],
  ])("min %s max %s => %s", (referenceMin, referenceMax, expected) => {
    expect(formatReference({ referenceMin, referenceMax })).toBe(expected);
  });
});

describe("buildExamReportDocument (BR-CLN-48)", () => {
  const base = { issuer: { name: "Clínica Sol", address: "Rua 1" }, patientName: "Maria Silva", examName: "Análises", examDate: "2026-11-08", resultNote: null, issuedAt: new Date("2026-11-08T10:00:00Z") };

  it("tabela parâmetro/valor/unidade/referência; só os fora do intervalo levam o rótulo único; contagem aritmética", () => {
    const { document, outOfReferenceCount, resultsCount } = buildExamReportDocument({
      ...base,
      results: [
        { parameter: "Hemoglobina", valueNumeric: 11.2, unit: "g/dL", referenceMin: 12, referenceMax: 16 },
        { parameter: "Glicose", valueNumeric: 100, unit: "mg/dL", referenceMin: 70, referenceMax: 99 },
        { parameter: "Plaquetas", valueNumeric: 150, unit: "x10^9/L", referenceMin: 150, referenceMax: 400 },
        { parameter: "Colesterol", valueNumeric: 300, unit: "mg/dL" },
        { parameter: "Cor", valueText: "Amarela" },
      ],
    });
    expect(resultsCount).toBe(5);
    expect(outOfReferenceCount).toBe(2);
    const table = document.blocks.find((b) => b.kind === "table");
    expect(table).toBeDefined();
    if (table?.kind !== "table") return;
    expect(table.columns.map((c) => c.title)).toEqual(["Parâmetro", "Valor", "Unidade", "Referência", "Indicação"]);
    expect(table.rows.map((r) => r.cells)).toEqual([
      ["Hemoglobina", "11.2", "g/dL", "12 – 16", OUT_OF_REFERENCE_LABEL],
      ["Glicose", "100", "mg/dL", "70 – 99", OUT_OF_REFERENCE_LABEL],
      ["Plaquetas", "150", "x10^9/L", "150 – 400", ""],
      ["Colesterol", "300", "mg/dL", "—", ""],
    ]);
    const text = JSON.stringify(document.blocks);
    expect(text).toContain(EXAM_REPORT_DISCLAIMER);
    expect(text).toContain("Cor: Amarela");
    // Sem setas nem interpretação: só o rótulo único e o aviso fixo.
    expect(text).not.toMatch(/alto|baixo|↑|↓|crítico|anormal/i);
    expect(document.footer).toBe("Documento não fiscal. Não substitui receita médica nem atestado.");
  });

  it("sem resultados numéricos não há tabela nem aviso; nota e profissional entram; cabeçalho = perfil da clínica", () => {
    const { document, outOfReferenceCount } = buildExamReportDocument({ ...base, results: [{ parameter: "Cor", valueText: "Amarela" }], resultNote: "Tudo normal para a clínica.", professionalName: "Dra. Lima" });
    expect(outOfReferenceCount).toBe(0);
    expect(document.blocks.some((b) => b.kind === "table")).toBe(false);
    expect(JSON.stringify(document.blocks)).not.toContain(EXAM_REPORT_DISCLAIMER);
    expect(JSON.stringify(document.blocks)).toContain("Profissional: Dra. Lima");
    expect(JSON.stringify(document.blocks)).toContain("Tudo normal para a clínica.");
    expect(document.header).toEqual(["Clínica Sol", "Rua 1"]);
  });
});
