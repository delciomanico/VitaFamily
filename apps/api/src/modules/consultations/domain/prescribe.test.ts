// Receita digital: elegibilidade pura (TC-MKT-133; BR-MKT-79..80; OP-126: o método não é critério).
// A tabela cartesiana é verificada contra um oráculo escrito de forma independente da implementação.
import { describe, expect, it } from "vitest";
import type { BookingStatus } from "./booking.js";
import { canPrescribe, PRESCRIPTION_WINDOW_MS, type CanPrescribeFacts } from "./prescribe.js";

const NOW = Date.UTC(2026, 10, 19, 10, 0);
const DAY_MS = 24 * 3_600_000;

const BOOLEANOS = [true, false] as const;
const ESTADOS: BookingStatus[] = ["REQUESTED", "CONFIRMED", "REJECTED", "CANCELLED", "COMPLETED", "NO_SHOW"];
const CATEGORIAS: CanPrescribeFacts["specialtyCategory"][] = ["HEALTH", "WELLNESS"];
const COMPLETED_AT: { nome: string; valor: number | null }[] = [
  { nome: "null", valor: null },
  { nome: "agora-1ms", valor: NOW - 1 },
  { nome: "agora-7d", valor: NOW - 7 * DAY_MS },
  { nome: "agora-7d-1ms", valor: NOW - 7 * DAY_MS - 1 },
];

/** Oráculo independente: escrito como lista de condições, sem reutilizar `canPrescribe`. */
function oraculo(f: CanPrescribeFacts, agora: number): boolean {
  const dentroDaJanela = f.completedAtMs !== null && agora - f.completedAtMs <= 7 * DAY_MS;
  const condicoes = [
    f.flagEnabled,
    f.professionalApproved,
    f.bookingStatus === "COMPLETED",
    f.specialtyCategory === "HEALTH",
    dentroDaJanela,
    !f.prescriptionExists,
  ];
  return condicoes.every((c) => c);
}

const TABELA = BOOLEANOS.flatMap((flagEnabled) =>
  BOOLEANOS.flatMap((professionalApproved) =>
    ESTADOS.flatMap((bookingStatus) =>
      CATEGORIAS.flatMap((specialtyCategory) =>
        BOOLEANOS.flatMap((prescriptionExists) =>
          COMPLETED_AT.map(({ nome, valor }) => ({
            nome: `flag=${String(flagEnabled)} aprovado=${String(professionalApproved)} estado=${bookingStatus} categoria=${specialtyCategory} receita=${String(prescriptionExists)} completedAt=${nome}`,
            facts: {
              flagEnabled,
              professionalApproved,
              bookingStatus,
              specialtyCategory,
              completedAtMs: valor,
              prescriptionExists,
            } satisfies CanPrescribeFacts,
          })),
        ),
      ),
    ),
  ),
);

describe("canPrescribe: tabela cartesiana com oráculo (TC-MKT-133)", () => {
  it("a tabela tem 2 × 2 × 6 × 2 × 2 × 4 = 384 combinações", () => {
    expect(TABELA).toHaveLength(384);
  });

  it.each(TABELA.map((c) => [c.nome, c.facts] as const))("%s", (_nome, facts) => {
    expect(canPrescribe(facts, NOW)).toBe(oraculo(facts, NOW));
  });

  it("só são verdadeiras as 2 combinações com todas as condições (completedAt em agora-1ms ou agora-7d)", () => {
    const verdadeiras = TABELA.filter((c) => canPrescribe(c.facts, NOW));
    expect(verdadeiras).toHaveLength(2);
    for (const { facts } of verdadeiras) {
      expect(facts).toMatchObject({ flagEnabled: true, professionalApproved: true, bookingStatus: "COMPLETED", specialtyCategory: "HEALTH", prescriptionExists: false });
      expect(facts.completedAtMs).not.toBeNull();
    }
  });
});

describe("canPrescribe: casos nomeados", () => {
  const base: CanPrescribeFacts = {
    flagEnabled: true,
    professionalApproved: true,
    bookingStatus: "COMPLETED",
    specialtyCategory: "HEALTH",
    completedAtMs: NOW,
    prescriptionExists: false,
  };

  it("fronteira de 7 dias exata é aceite; 1 ms depois é recusada", () => {
    const completedAtMs = NOW - 7 * DAY_MS;
    expect(canPrescribe({ ...base, completedAtMs }, NOW)).toBe(true);
    expect(canPrescribe({ ...base, completedAtMs }, NOW + 1)).toBe(false);
  });

  it("a janela de PRESCRIPTION_WINDOW_MS são 7 dias", () => {
    expect(PRESCRIPTION_WINDOW_MS).toBe(7 * DAY_MS);
  });

  it("o exemplo base é elegível e cada condição, isolada, torna-o não elegível", () => {
    expect(canPrescribe(base, NOW)).toBe(true);
    expect(canPrescribe({ ...base, flagEnabled: false }, NOW)).toBe(false);
    expect(canPrescribe({ ...base, professionalApproved: false }, NOW)).toBe(false);
    expect(canPrescribe({ ...base, bookingStatus: "CONFIRMED" }, NOW)).toBe(false);
    expect(canPrescribe({ ...base, specialtyCategory: "WELLNESS" }, NOW)).toBe(false);
    expect(canPrescribe({ ...base, completedAtMs: null }, NOW)).toBe(false);
    expect(canPrescribe({ ...base, prescriptionExists: true }, NOW)).toBe(false);
  });

  it("CanPrescribeFacts não tem campo de método (OP-126: o método de consulta não é critério)", () => {
    const exemplo: CanPrescribeFacts = { ...base };
    expect(Object.keys(exemplo).sort()).toEqual(
      ["bookingStatus", "completedAtMs", "flagEnabled", "prescriptionExists", "professionalApproved", "specialtyCategory"].sort(),
    );
    expect(Object.keys(exemplo)).not.toContain("method");
  });
});
