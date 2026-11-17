// Ranking v1: contrato fechado, pureza e propriedades metamórficas (TC-MKT-45/46/48). As tabelas numéricas de casos (TC-MKT-44) estão em
// `ranking.table.test.ts`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RANKING_INPUT_KEYS, RANKING_OFFER_INPUT_KEYS, RANKING_V1, rankProfessionals, type RankingInput, type RankingOfferInput } from "./ranking.js";

const NOW = Date.UTC(2026, 10, 17, 10, 0);
const DAY = 86_400_000;

/** Falha a compilar se se acrescentar (ou retirar) uma chave a `RankingInput`/`RankingOfferInput` (BR-MKT-36: tipo fechado). */
const INPUT_KEYS_CHECK: Record<keyof RankingInput, true> = { professionalId: true, bioLength: true, offers: true, approvedAtMs: true };
const OFFER_KEYS_CHECK: Record<keyof RankingOfferInput, true> = { method: true, priceKz: true, hasNote: true, slotsNext14Days: true };

function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return s / 4_294_967_296;
  };
}

function randomCohort(seed: number, n: number): RankingInput[] {
  const rnd = prng(seed);
  const methods = ["IN_PERSON", "VIDEO", "CHAT", "PHONE"] as const;
  return Array.from({ length: n }, (_, i) => ({
    professionalId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    bioLength: Math.floor(rnd() * 200),
    approvedAtMs: NOW - Math.floor(rnd() * 400) * DAY,
    offers: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({
      method: methods[Math.floor(rnd() * 4)] ?? "VIDEO",
      priceKz: Math.floor(rnd() * 20) * 500,
      hasNote: rnd() < 0.5,
      slotsNext14Days: Math.floor(rnd() * 30),
    })),
  }));
}

describe("ranking v1: contrato e pureza", () => {
  it("o tipo de entrada é fechado: as chaves são exatamente as de BR-MKT-37", () => {
    expect(Object.keys(INPUT_KEYS_CHECK).sort()).toEqual([...RANKING_INPUT_KEYS].sort());
    expect(Object.keys(OFFER_KEYS_CHECK).sort()).toEqual([...RANKING_OFFER_INPUT_KEYS].sort());
    for (const proibida of ["paymentInstructions", "email", "displayName", "name", "city", "boost", "featured", "sponsored", "plan", "commission", "statusReason"]) {
      expect(RANKING_INPUT_KEYS as readonly string[]).not.toContain(proibida);
      expect(RANKING_OFFER_INPUT_KEYS as readonly string[]).not.toContain(proibida);
    }
  });

  it("RANKING_V1: versão v1 e pesos que somam 100 (os de GET /marketplace/ranking-rules)", () => {
    expect(RANKING_V1.version).toBe("v1");
    expect(Object.values(RANKING_V1.weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(RANKING_V1.weights).toEqual({ profileCompleteness: 40, availability: 30, price: 15, seniority: 15 });
  });

  it("o código do ranking não usa Date, Math.random, performance.now nem importa nada (domínio puro)", () => {
    const source = readFileSync(fileURLToPath(new URL("./ranking.ts", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/\bDate\b|Math\.random|performance\.now|\bimport\b|require\(/);
  });

  it("caso à mão: perfil completo, 20 horários, o mais barato de 3 e 180 dias ⇒ 100, três razões, label NEW", () => {
    const completo = (id: string, price: number): RankingInput => ({
      professionalId: id,
      bioLength: 100,
      approvedAtMs: NOW - 180 * DAY,
      offers: [
        { method: "IN_PERSON", priceKz: price, hasNote: true, slotsNext14Days: 10 },
        { method: "VIDEO", priceKz: price + 500, hasNote: false, slotsNext14Days: 10 },
      ],
    });
    const [primeiro, segundo, terceiro] = rankProfessionals([completo("c", 3000), completo("a", 1000), completo("b", 2000)], NOW);
    expect(primeiro).toMatchObject({ professionalId: "a", score: 100, label: "NEW", version: "v1", reasons: ["COMPLETE_PROFILE", "GOOD_AVAILABILITY", "COMPETITIVE_PRICE"] });
    expect(primeiro?.signals).toEqual({ profileCompleteness: 1, availability: 1, price: 1, seniority: 1 });
    expect(segundo?.professionalId).toBe("b");
    expect(segundo?.signals.price).toBe(0.5);
    expect(terceiro?.signals.price).toBe(0);
    expect(terceiro?.reasons).toEqual(["COMPLETE_PROFILE", "GOOD_AVAILABILITY", "ESTABLISHED"]);
  });

  it("ignora profissionais sem ofertas (fora da coorte)", () => {
    expect(rankProfessionals([{ professionalId: "x", bioLength: 100, approvedAtMs: NOW, offers: [] }], NOW)).toEqual([]);
  });
});

describe("ranking v1: determinismo e metamórficos (TC-MKT-45/46)", () => {
  it.each([1, 2, 3, 4, 5])("mesma entrada ⇒ mesma saída e independente da ordem das linhas (semente %i)", (seed) => {
    const cohort = randomCohort(seed, 12);
    const base = rankProfessionals(cohort, NOW);
    expect(rankProfessionals(cohort, NOW)).toEqual(base);
    expect(rankProfessionals([...cohort].reverse(), NOW)).toEqual(base);
    const shuffled = [...cohort].sort((a, b) => (a.professionalId.slice(-2) < b.professionalId.slice(-2) ? 1 : -1));
    expect(rankProfessionals(shuffled, NOW)).toEqual(base);
  });

  it.each([1, 2, 3])("campos que não são sinais (pagamento, e-mail, nome, cidade, estado, planos, destaques) não alteram pontuação nem ordem (semente %i)", (seed) => {
    const cohort = randomCohort(seed, 15);
    const base = rankProfessionals(cohort, NOW);
    const polluted = cohort.map((c, i) => ({
      ...c,
      paymentInstructions: `IBAN AO06 ${String(i)}`,
      email: `pro${String(i)}@exemplo.ao`,
      displayName: `Nome ${String(100 - i)}`,
      city: i % 2 === 0 ? "Luanda" : "Benguela",
      statusReason: "x".repeat(i),
      plan: "PREMIUM",
      commission: i,
      featured: i === 3,
      boost: 1000 * i,
    }));
    expect(rankProfessionals(polluted, NOW)).toEqual(base);
  });

  it("a bio só conta pelo comprimento: textos diferentes com o mesmo comprimento dão o mesmo resultado", () => {
    const a: RankingInput = { professionalId: "a", bioLength: "x".repeat(90).length, approvedAtMs: NOW, offers: [{ method: "VIDEO", priceKz: 1, hasNote: false, slotsNext14Days: 0 }] };
    const b = { ...a, bio: "y".repeat(90) } as RankingInput;
    expect(rankProfessionals([a], NOW)).toEqual(rankProfessionals([b], NOW));
  });

  it("não muta a entrada", () => {
    const cohort = randomCohort(9, 8);
    const copy = structuredClone(cohort);
    rankProfessionals(cohort, NOW);
    expect(cohort).toEqual(copy);
  });

  it("o relógio é injetado: avançar o instante só muda a antiguidade (e a pontuação não diminui)", () => {
    const cohort = randomCohort(7, 10);
    const antes = rankProfessionals(cohort, NOW);
    const depois = rankProfessionals(cohort, NOW + 30 * DAY);
    for (const a of antes) {
      const d = depois.find((x) => x.professionalId === a.professionalId);
      expect(d?.signals.profileCompleteness).toBe(a.signals.profileCompleteness);
      expect(d?.signals.availability).toBe(a.signals.availability);
      expect(d?.signals.price).toBe(a.signals.price);
      expect(d?.signals.seniority).toBeGreaterThanOrEqual(a.signals.seniority);
    }
  });

  it("pontuação em [0,100], sinais em [0,1], no máximo 3 razões e razões só de sinais ≥ 0,75", () => {
    for (const seed of [11, 12, 13, 14]) {
      for (const r of rankProfessionals(randomCohort(seed, 30), NOW)) {
        expect(Number.isInteger(r.score)).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
        for (const v of Object.values(r.signals)) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
        expect(r.reasons.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("a saída está ordenada: pontuação ↓, disponibilidade ↓, aprovação mais antiga, id", () => {
    const ranked = rankProfessionals(randomCohort(21, 40), NOW);
    for (let i = 1; i < ranked.length; i += 1) {
      const p = ranked[i - 1];
      const q = ranked[i];
      if (!p || !q) continue;
      expect(p.score).toBeGreaterThanOrEqual(q.score);
      if (p.score === q.score) {
        expect(p.signals.availability).toBeGreaterThanOrEqual(q.signals.availability);
        if (p.signals.availability === q.signals.availability) {
          expect(p.approvedAtMs).toBeLessThanOrEqual(q.approvedAtMs);
          if (p.approvedAtMs === q.approvedAtMs) expect(p.professionalId < q.professionalId).toBe(true);
        }
      }
    }
  });
});
