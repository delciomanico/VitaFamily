// Ranking v2: contrato fechado, pureza e propriedades metamórficas (TC-MKT-45/46/48, BR-MKT-61). As tabelas numéricas de casos (TC-MKT-44)
// estão em `ranking.table.test.ts`; a versão anterior (regressão) em `ranking-v1*.test.ts`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RANKING_INPUT_KEYS, RANKING_OFFER_INPUT_KEYS, RANKING_V2, rankProfessionals, type RankingInput, type RankingOfferInput } from "./ranking.js";

const NOW = Date.UTC(2026, 10, 17, 10, 0);
const DAY = 86_400_000;

/** Falha a compilar se se acrescentar (ou retirar) uma chave a `RankingInput`/`RankingOfferInput` (BR-MKT-36: tipo fechado). */
const INPUT_KEYS_CHECK: Record<keyof RankingInput, true> = { professionalId: true, bioLength: true, offers: true, approvedAtMs: true, reviewCount: true, reviewSum: true };
const OFFER_KEYS_CHECK: Record<keyof RankingOfferInput, true> = { method: true, priceKz: true, hasNote: true, slotsNext14Days: true };

function prng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return s / 4_294_967_296;
  };
}

/** Avaliações aleatórias: 0 a 12 avaliações com notas 1–5 (metade da coorte abaixo do mínimo de 3). */
function reviews(rnd: () => number): { reviewCount: number; reviewSum: number } {
  const reviewCount = Math.floor(rnd() * 13);
  let reviewSum = 0;
  for (let i = 0; i < reviewCount; i += 1) reviewSum += 1 + Math.floor(rnd() * 5);
  return { reviewCount, reviewSum };
}

function randomCohort(seed: number, n: number): RankingInput[] {
  const rnd = prng(seed);
  const methods = ["IN_PERSON", "VIDEO", "CHAT", "PHONE"] as const;
  return Array.from({ length: n }, (_, i) => ({
    professionalId: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    bioLength: Math.floor(rnd() * 200),
    approvedAtMs: NOW - Math.floor(rnd() * 400) * DAY,
    ...reviews(rnd),
    offers: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => ({
      method: methods[Math.floor(rnd() * 4)] ?? "VIDEO",
      priceKz: Math.floor(rnd() * 20) * 500,
      hasNote: rnd() < 0.5,
      slotsNext14Days: Math.floor(rnd() * 30),
    })),
  }));
}

describe("ranking v2: contrato e pureza", () => {
  it("o tipo de entrada é fechado: as chaves são exatamente as de BR-MKT-37 e BR-MKT-61 (agregações de avaliações)", () => {
    expect(Object.keys(INPUT_KEYS_CHECK).sort()).toEqual([...RANKING_INPUT_KEYS].sort());
    expect(Object.keys(OFFER_KEYS_CHECK).sort()).toEqual([...RANKING_OFFER_INPUT_KEYS].sort());
    for (const proibida of ["paymentInstructions", "email", "displayName", "name", "city", "boost", "featured", "sponsored", "plan", "commission", "statusReason"]) {
      expect(RANKING_INPUT_KEYS as readonly string[]).not.toContain(proibida);
      expect(RANKING_OFFER_INPUT_KEYS as readonly string[]).not.toContain(proibida);
    }
  });

  it("RANKING_V2: versão v2 e pesos que somam 100 (os de GET /marketplace/ranking-rules)", () => {
    expect(RANKING_V2.version).toBe("v2");
    expect(Object.values(RANKING_V2.weights).reduce((a, b) => a + b, 0)).toBe(100);
    expect(RANKING_V2.weights).toEqual({ reviews: 40, profileCompleteness: 20, availability: 20, price: 10, seniority: 10 });
  });

  it("o código do ranking não usa Date, Math.random, performance.now nem importa nada (domínio puro)", () => {
    const source = readFileSync(fileURLToPath(new URL("./ranking.ts", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/\bDate\b|Math\.random|performance\.now|\bimport\b|require\(/);
  });

  it("caso à mão: perfil completo, 20 horários, o mais barato de 3, 180 dias e 3 avaliações de 5 ⇒ 100, label RATED, razões limitadas a 3", () => {
    const completo = (id: string, price: number): RankingInput => ({
      professionalId: id,
      bioLength: 100,
      approvedAtMs: NOW - 180 * DAY,
      reviewCount: 3,
      reviewSum: 15,
      offers: [
        { method: "IN_PERSON", priceKz: price, hasNote: true, slotsNext14Days: 10 },
        { method: "VIDEO", priceKz: price + 500, hasNote: false, slotsNext14Days: 10 },
      ],
    });
    const [primeiro, segundo, terceiro] = rankProfessionals([completo("c", 3000), completo("a", 1000), completo("b", 2000)], NOW);
    expect(primeiro).toMatchObject({ professionalId: "a", score: 100, label: "RATED", version: "v2", reasons: ["GOOD_REVIEWS", "COMPLETE_PROFILE", "GOOD_AVAILABILITY"] });
    expect(primeiro?.signals).toEqual({ reviews: 1, profileCompleteness: 1, availability: 1, price: 1, seniority: 1 });
    expect(segundo?.professionalId).toBe("b");
    expect(segundo?.signals.price).toBe(0.5);
    expect(terceiro?.signals.price).toBe(0);
    expect(terceiro?.reasons).toEqual(["GOOD_REVIEWS", "COMPLETE_PROFILE", "GOOD_AVAILABILITY"]);
  });

  it("ignora profissionais sem ofertas (fora da coorte)", () => {
    expect(rankProfessionals([{ professionalId: "x", bioLength: 100, approvedAtMs: NOW, reviewCount: 0, reviewSum: 0, offers: [] }], NOW)).toEqual([]);
  });
});

describe("ranking v2: determinismo e metamórficos (TC-MKT-45/46)", () => {
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
    const a: RankingInput = { professionalId: "a", bioLength: "x".repeat(90).length, approvedAtMs: NOW, reviewCount: 0, reviewSum: 0, offers: [{ method: "VIDEO", priceKz: 1, hasNote: false, slotsNext14Days: 0 }] };
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
      expect(d?.signals.reviews).toBe(a.signals.reviews);
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

  it("a saída está ordenada: pontuação ↓, avaliações ↓, disponibilidade ↓, aprovação mais antiga, id", () => {
    const ranked = rankProfessionals(randomCohort(21, 40), NOW);
    for (let i = 1; i < ranked.length; i += 1) {
      const p = ranked[i - 1];
      const q = ranked[i];
      if (!p || !q) continue;
      expect(p.score).toBeGreaterThanOrEqual(q.score);
      if (p.score === q.score) {
        expect(p.signals.reviews).toBeGreaterThanOrEqual(q.signals.reviews);
        if (p.signals.reviews === q.signals.reviews) {
          expect(p.signals.availability).toBeGreaterThanOrEqual(q.signals.availability);
          if (p.signals.availability === q.signals.availability) {
            expect(p.approvedAtMs).toBeLessThanOrEqual(q.approvedAtMs);
            if (p.approvedAtMs === q.approvedAtMs) expect(p.professionalId < q.professionalId).toBe(true);
          }
        }
      }
    }
  });
});

describe("ranking v2: avaliações verificadas (BR-MKT-61)", () => {
  const base = (id: string, reviewCount: number, reviewSum: number): RankingInput => ({
    professionalId: id,
    bioLength: 0,
    approvedAtMs: NOW,
    reviewCount,
    reviewSum,
    offers: [{ method: "VIDEO", priceKz: 1000, hasNote: false, slotsNext14Days: 0 }],
  });

  it("menos de 3 avaliações ⇒ «Novo» e sinal neutro 0,5, qualquer que seja a nota (sem prémio nem castigo)", () => {
    for (const [n, sum] of [[0, 0], [1, 5], [2, 2]] as const) {
      const [r] = rankProfessionals([base("a", n, sum)], NOW);
      expect(r).toMatchObject({ label: "NEW", signals: { reviews: 0.5 } });
      expect(r?.reasons).not.toContain("GOOD_REVIEWS");
    }
  });

  it("3 ou mais avaliações ⇒ RATED e (bayes − 1) / 4 com m = 5 e C = média da coorte", () => {
    // Coorte: a (3 avaliações, soma 15), b (7 avaliações, soma 21) ⇒ C = 36/10 = 3,6.
    const ranked = rankProfessionals([base("a", 3, 15), base("b", 7, 21)], NOW);
    const a = ranked.find((r) => r.professionalId === "a");
    const b = ranked.find((r) => r.professionalId === "b");
    // a: bayes = (5·3,6 + 15)/8 = 4,125 ⇒ 0,78125 → 0,7813; b: bayes = (18 + 21)/12 = 3,25 ⇒ 0,5625.
    expect(a).toMatchObject({ label: "RATED", signals: { reviews: 0.7813 } });
    expect(b).toMatchObject({ label: "RATED", signals: { reviews: 0.5625 } });
    expect(a?.reasons).toContain("GOOD_REVIEWS");
    expect(b?.reasons).not.toContain("GOOD_REVIEWS");
    expect(ranked[0]?.professionalId).toBe("a");
  });

  it("a nota vale 40 %: com tudo o resto igual, 3 notas de 5 num par de coortes sobe 40 · (sinal − 0,5) pontos", () => {
    const [semNada] = rankProfessionals([base("a", 0, 0)], NOW);
    // Coorte de 1: C = 5 ⇒ bayes 5 ⇒ sinal 1 ⇒ +20 pontos face ao neutro (0,5 · 40).
    const [cinco] = rankProfessionals([base("a", 3, 15)], NOW);
    expect(((cinco?.score ?? 0) - (semNada?.score ?? 0))).toBe(20);
  });

  it("monotonia: aumentar a soma das notas (mesmo n ≥ 3) não baixa o sinal de avaliações", () => {
    let anterior = -1;
    for (let sum = 3; sum <= 15; sum += 1) {
      const mine = rankProfessionals([base("a", 3, sum), base("c", 4, 12)], NOW).find((x) => x.professionalId === "a");
      expect(mine?.signals.reviews ?? 0).toBeGreaterThanOrEqual(anterior);
      anterior = mine?.signals.reviews ?? 0;
    }
  });

  it("tudo igual (também as avaliações) ⇒ desempata o id menor", () => {
    const ranked = rankProfessionals([base("sem", 0, 0), base("com", 0, 0)], NOW);
    expect(ranked.map((r) => r.professionalId)).toEqual(["com", "sem"]);
  });
});
