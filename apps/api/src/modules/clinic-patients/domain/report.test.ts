// TC-CLN-16 (parte pura): janela dos indicadores e regras de contagem de BR-CLN-29.
import { describe, expect, it } from "vitest";
import { ValidationError } from "../../../platform/errors/index.js";
import { buildReport, parseReportWindow, type ReportFact, type ReportSlot } from "./report.js";

describe("parseReportWindow", () => {
  it("dias locais inclusivos em Europe/Lisbon (inverno UTC+0, verão UTC+1)", () => {
    const winter = parseReportWindow("2026-01-10", "2026-01-10");
    expect(winter.start.toISOString()).toBe("2026-01-10T00:00:00.000Z");
    expect(winter.end.toISOString()).toBe("2026-01-11T00:00:00.000Z");
    const summer = parseReportWindow("2026-07-01", "2026-07-07");
    expect(summer.start.toISOString()).toBe("2026-06-30T23:00:00.000Z");
    expect(summer.end.toISOString()).toBe("2026-07-07T23:00:00.000Z");
  });

  it("366 dias é o máximo; 367, to < from, formato inválido e ausentes => VALIDATION_ERROR", () => {
    expect(() => parseReportWindow("2026-01-01", "2026-12-31")).not.toThrow();
    expect(() => parseReportWindow("2024-01-01", "2024-12-31")).not.toThrow(); // bissexto: 366 dias
    expect(() => parseReportWindow("2024-01-01", "2025-01-01")).toThrow(ValidationError); // 367
    expect(() => parseReportWindow("2026-02-02", "2026-02-01")).toThrow(ValidationError);
    expect(() => parseReportWindow("2026-02-30", "2026-03-01")).toThrow(ValidationError);
    expect(() => parseReportWindow(undefined, "2026-03-01")).toThrow(ValidationError);
  });
});

const slot = (id: string, capacity: number, professionalId: string | null): ReportSlot => ({ id, capacity, professionalId });
const fact = (kind: ReportFact["kind"], status: string, slotId: string | null, professionalId: string | null, declined = false): ReportFact => ({ kind, status, slotId, professionalId, declined });

describe("buildReport (BR-CLN-29)", () => {
  const slots = [slot("s1", 1, "p1"), slot("s2", 2, "p1"), slot("s3", 1, "p2"), slot("s4", 1, null), slot("s5", 1, "p2")];
  const facts: ReportFact[] = [
    fact("APPOINTMENT", "COMPLETED", "s1", "p1"),
    fact("VISIT", "COMPLETED", "s1", "p1"), // mesma vaga: slotsBooked limitado à capacidade
    fact("EXAM", "COMPLETED", "s2", "p1"),
    fact("EXAM", "SCHEDULED", "s2", "p1"),
    fact("EXAM", "CANCELLED", "s2", "p1"),
    fact("APPOINTMENT", "NO_SHOW", "s3", "p2"),
    fact("APPOINTMENT", "SCHEDULED", "s5", "p2"), // passada ainda SCHEDULED: ocupa mas não entra nas taxas
    fact("APPOINTMENT", "REJECTED", "s5", "p2"),
    fact("APPOINTMENT", "CANCELLED", "s4", null, true),
    fact("VISIT", "CANCELLED", "s4", null),
    fact("APPOINTMENT", "COMPLETED", null, null), // sem horário: conta em completed, não em slotsBooked
  ];

  it("totais e linhas coincidem com a contagem manual", () => {
    const { totals, rows } = buildReport(slots, facts);
    expect(totals).toEqual({ slotsTotal: 6, slotsBooked: 5, occupancyRate: 5 / 6, completed: 3, noShows: 1, noShowRate: 1 / 4, cancellations: 2, declinedByPatient: 1, examsCompleted: 1 });
    const byId = new Map(rows.map((r) => [r.professionalId, r]));
    expect(byId.get("p1")).toMatchObject({ slotsTotal: 3, slotsBooked: 3, completed: 2, noShows: 0, noShowRate: 0, cancellations: 0 });
    expect(byId.get("p2")).toMatchObject({ slotsTotal: 2, slotsBooked: 2, completed: 0, noShows: 1, noShowRate: 1 });
    expect(byId.get(null)).toMatchObject({ slotsTotal: 1, slotsBooked: 0, occupancyRate: 0, completed: 1, cancellations: 2, declinedByPatient: 1, noShows: 0, noShowRate: 0 });
    expect(rows).toHaveLength(3);
  });

  it("com professionalId só essa linha (totais incluídos); REJECTED nunca é cancelamento", () => {
    const { totals, rows } = buildReport(slots, facts, "p2");
    expect(rows.map((r) => r.professionalId)).toEqual(["p2"]);
    expect(totals).toMatchObject({ slotsTotal: 2, slotsBooked: 2, noShows: 1, cancellations: 0, examsCompleted: 0 });
  });

  it("sem horários nem marcações => taxas nulas (sem divisão por zero) e linha 'sem profissional'", () => {
    const { totals, rows } = buildReport([], []);
    expect(totals).toEqual({ slotsTotal: 0, slotsBooked: 0, occupancyRate: null, completed: 0, noShows: 0, noShowRate: null, cancellations: 0, declinedByPatient: 0, examsCompleted: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.professionalId).toBeNull();
  });

  it("profissional filtrado sem dados devolve a sua linha a zeros", () => {
    const { rows } = buildReport([], [], "p9");
    expect(rows).toEqual([expect.objectContaining({ professionalId: "p9", slotsTotal: 0, occupancyRate: null })]);
  });
});
