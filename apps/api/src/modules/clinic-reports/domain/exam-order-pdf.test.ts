// BR-CLN-54/55: layout puro dos PDF "Pedido de exame" e "Declaração de presença".
import { describe, expect, it } from "vitest";
import type { ExamOrder } from "./exam-order.js";
import { attendanceStatementFilename, buildAttendanceStatementDocument, buildExamOrderDocument, examOrderFilename } from "./exam-order-pdf.js";

const T = new Date("2026-07-01T08:30:00Z"); // verão: Europe/Lisbon = UTC+1
const NOW = new Date("2026-07-01T12:00:00Z");

function order(overrides: Partial<ExamOrder> = {}): ExamOrder {
  return {
    id: "o1", clinicId: "c1", bookingKind: "APPOINTMENT", bookingId: "b1", clinicPatientId: null, name: "Hemograma", serviceTypeId: null, note: null, urgent: false,
    status: "ORDERED", bookedHere: false, patientName: "Maria Silva", patientBirthDate: "1990-03-04", consultationAt: T, authorName: "Dr. João Costa",
    authorAccountId: "a1", cancelledAt: null, createdAt: T, updatedAt: T, ...overrides,
  };
}

describe("buildExamOrderDocument (BR-CLN-54)", () => {
  it("lista numerada com URGENTE e nota, paciente com nascimento, data local, assinatura textual e rodapé fixo", () => {
    const doc = buildExamOrderDocument([order(), order({ id: "o2", name: "Glicemia", urgent: true, note: "Jejum de 8 h" })], { name: "Clínica Sol", address: "Rua 1" }, NOW);
    const text = JSON.stringify(doc.blocks);
    expect(doc.title).toBe("Pedido de exame");
    expect(doc.header).toEqual(["Clínica Sol", "Rua 1"]);
    expect(text).toContain("Paciente: Maria Silva (nascimento: 04/03/1990)");
    expect(text).toContain("Data da consulta: 01/07/2026, 09:30");
    expect(text).toContain("1. Hemograma");
    expect(text).toContain("2. Glicemia — URGENTE");
    expect(text).toContain("Nota: Jejum de 8 h");
    expect(text).toContain("Dr. João Costa");
    expect(doc.footer).toBe("Documento não fiscal. Não substitui receita médica nem atestado.");
  });

  it("sem data de nascimento no registo, não a inventa", () => {
    const text = JSON.stringify(buildExamOrderDocument([order({ patientBirthDate: null })], { name: "C" }, NOW).blocks);
    expect(text).toContain("Paciente: Maria Silva");
    expect(text).not.toContain("nascimento");
  });

  it("nome do ficheiro só com a data da consulta (sem dados pessoais)", () => {
    expect(examOrderFilename(T)).toBe("pedido-exame-20260701.pdf");
    expect(examOrderFilename(new Date("2026-06-30T23:30:00Z"))).toBe("pedido-exame-20260701.pdf"); // 00:30 em Lisboa
  });
});

describe("buildAttendanceStatementDocument (BR-CLN-55)", () => {
  it("texto fixo, sem nascimento, sem especialidade/diagnóstico/duração; profissional só quando indicado", () => {
    const without = buildAttendanceStatementDocument({ patientName: "Maria Silva", consultationAt: T }, { name: "Clínica Sol" }, NOW);
    const text = JSON.stringify(without.blocks);
    expect(without.title).toBe("Declaração de presença");
    expect(text).toContain("Declara-se que o/a paciente Maria Silva compareceu à consulta marcada para 01/07/2026, 09:30.");
    expect(text).toContain("Emitida em 01/07/2026, 13:00.");
    expect(text).not.toContain("Profissional");
    expect(text).not.toContain("nascimento");
    expect(without.footer).toBe("Documento não fiscal. Não é atestado médico nem comprova a existência de doença.");

    const withPro = JSON.stringify(buildAttendanceStatementDocument({ patientName: "Maria Silva", consultationAt: T, professionalName: "Dr. João Costa" }, { name: "C" }, NOW).blocks);
    expect(withPro).toContain("Profissional: Dr. João Costa");
  });

  it("nome do ficheiro só com a data", () => {
    expect(attendanceStatementFilename(T)).toBe("declaracao-20260701.pdf");
  });
});
