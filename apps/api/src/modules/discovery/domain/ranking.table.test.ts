// Ranking v2: tabelas de casos numéricos (TC-MKT-44). Os valores esperados foram calculados à mão a partir de BR-MKT-37 e BR-MKT-61 (pesos v2: 40/20/20/10/10), sem copiar a
// fórmula de `ranking.ts`. Os sinais testam-se diretamente (casos 1 a 4); a pontuação, as razões e o desempate testam-se a partir de
// `scoreOf`, `reasonsFor` e `rankProfessionals` (casos 5 a 7). As propriedades gerais (determinismo, metamórficos) estão em `ranking.test.ts`.
import { describe, expect, it } from "vitest";
import {
  availabilitySignal,
  completenessSignal,
  priceSignal,
  rankProfessionals,
  reasonsFor,
  reviewsSignal,
  cohortMeanRating,
  scoreOf,
  senioritySignal,
  type RankingInput,
  type RankingOfferInput,
  type RankingSignalValues,
} from "./ranking.js";

const NOW = Date.UTC(2026, 10, 17, 10, 0);
const DAY = 86_400_000;

/** Oferta de base (VIDEO, 1000 Kz, sem nota, 0 horários); os campos indicados substituem os de base. */
function oferta(campos: Partial<RankingOfferInput> = {}): RankingOfferInput {
  return { method: "VIDEO", priceKz: 1000, hasNote: false, slotsNext14Days: 0, ...campos };
}

/** Profissional de base (bio vazia, uma oferta de base, aprovado agora); os campos indicados substituem os de base. */
function profissional(campos: Partial<RankingInput> = {}): RankingInput {
  return { professionalId: "pro", bioLength: 0, offers: [oferta()], approvedAtMs: NOW, reviewCount: 0, reviewSum: 0, ...campos };
}

/** Coorte em que cada profissional tem ofertas com os preços indicados (o id é `p0`, `p1`, ...). */
function coortePorPrecos(precos: number[][]): RankingInput[] {
  return precos.map((ofertas, i) => profissional({ professionalId: `p${String(i)}`, offers: ofertas.map((priceKz) => oferta({ priceKz })) }));
}

/** Pontuação de uma coorte de uma só entrada (a entrada é a única: preço neutro 0,5 e, se tiver 3 ou mais avaliações, C é a sua própria média). */
function pontuacaoSozinho(entrada: RankingInput): number {
  const [unico] = rankProfessionals([entrada], NOW).map((r) => r.score);
  return unico ?? Number.NaN;
}

describe("(1) completude: bio, nota, métodos e número de ofertas (pontos/100)", () => {
  it.each([
    { nome: "bio 0 e sem ofertas", bioLength: 0, offers: [] as RankingOfferInput[], esperado: 0 },
    { nome: "bio 1 e sem ofertas", bioLength: 1, offers: [] as RankingOfferInput[], esperado: 0.2 },
    { nome: "bio 79 e sem ofertas", bioLength: 79, offers: [] as RankingOfferInput[], esperado: 0.2 },
    { nome: "bio 80 e sem ofertas", bioLength: 80, offers: [] as RankingOfferInput[], esperado: 0.4 },
    { nome: "bio 0, uma oferta sem nota", bioLength: 0, offers: [oferta()], esperado: 0 },
    { nome: "bio 0, uma oferta com nota", bioLength: 0, offers: [oferta({ hasNote: true })], esperado: 0.2 },
    { nome: "bio 1, uma oferta sem nota", bioLength: 1, offers: [oferta()], esperado: 0.2 },
    { nome: "bio 1, uma oferta com nota", bioLength: 1, offers: [oferta({ hasNote: true })], esperado: 0.4 },
    { nome: "bio 79, uma oferta sem nota", bioLength: 79, offers: [oferta()], esperado: 0.2 },
    { nome: "bio 80, uma oferta sem nota", bioLength: 80, offers: [oferta()], esperado: 0.4 },
    { nome: "bio 80, uma oferta com nota", bioLength: 80, offers: [oferta({ hasNote: true })], esperado: 0.6 },
    { nome: "bio 80, duas ofertas do mesmo método sem nota", bioLength: 80, offers: [oferta(), oferta()], esperado: 0.6 },
    { nome: "bio 80, duas ofertas de métodos distintos sem nota", bioLength: 80, offers: [oferta({ method: "VIDEO" }), oferta({ method: "CHAT" })], esperado: 0.8 },
    {
      nome: "bio 80, duas ofertas de métodos distintos e uma com nota",
      bioLength: 80,
      offers: [oferta({ method: "VIDEO", hasNote: true }), oferta({ method: "CHAT" })],
      esperado: 1,
    },
    { nome: "bio 80, duas ofertas com nota do mesmo método", bioLength: 80, offers: [oferta({ hasNote: true }), oferta({ hasNote: true })], esperado: 0.8 },
    { nome: "bio 79, duas ofertas do mesmo método, uma com nota", bioLength: 79, offers: [oferta({ hasNote: true }), oferta()], esperado: 0.6 },
    { nome: "bio 0, duas ofertas de métodos distintos sem nota", bioLength: 0, offers: [oferta({ method: "VIDEO" }), oferta({ method: "CHAT" })], esperado: 0.4 },
    {
      nome: "bio 0, duas ofertas de métodos distintos com nota",
      bioLength: 0,
      offers: [oferta({ method: "VIDEO", hasNote: true }), oferta({ method: "CHAT" })],
      esperado: 0.6,
    },
    {
      nome: "bio 80, três ofertas de métodos distintos com nota em todas (satura em 1)",
      bioLength: 80,
      offers: [oferta({ method: "IN_PERSON", hasNote: true }), oferta({ method: "VIDEO", hasNote: true }), oferta({ method: "PHONE", hasNote: true })],
      esperado: 1,
    },
  ])("$nome ⇒ $esperado", ({ bioLength, offers, esperado }) => {
    expect(completenessSignal(profissional({ bioLength, offers }))).toBeCloseTo(esperado, 10);
  });
});

describe("(2) disponibilidade: soma dos horários das ofertas, saturada em 20", () => {
  it.each([
    { nome: "sem ofertas", slots: [] as number[], esperado: 0 },
    { nome: "0 horários", slots: [0], esperado: 0 },
    { nome: "10 horários", slots: [10], esperado: 0.5 },
    { nome: "19 horários", slots: [19], esperado: 0.95 },
    { nome: "20 horários (limiar de saturação)", slots: [20], esperado: 1 },
    { nome: "25 horários (saturado em 1)", slots: [25], esperado: 1 },
    { nome: "soma de 4 + 6 + 0 = 10 horários", slots: [4, 6, 0], esperado: 0.5 },
    { nome: "soma de 7 + 8 + 5 = 20 horários", slots: [7, 8, 5], esperado: 1 },
    { nome: "soma de 3 + 4 = 7 horários", slots: [3, 4], esperado: 0.35 },
    { nome: "soma de 9 + 9 = 18 horários", slots: [9, 9], esperado: 0.9 },
    { nome: "soma de 12 + 5 = 17 horários (sem saturação)", slots: [12, 5], esperado: 0.85 },
    { nome: "soma de 10 + 15 = 25 horários (saturado em 1)", slots: [10, 15], esperado: 1 },
    { nome: "três ofertas sem horários", slots: [0, 0, 0], esperado: 0 },
  ])("$nome ⇒ $esperado", ({ slots, esperado }) => {
    const entrada = profissional({ offers: slots.map((slotsNext14Days) => oferta({ slotsNext14Days })) });
    expect(availabilitySignal(entrada)).toBeCloseTo(esperado, 10);
  });
});

describe("(3) preço: menor preço do profissional, percentil na coorte (coorte < 3 ⇒ 0,5)", () => {
  it.each([
    { nome: "coorte de 1 é neutra", precos: [[1000]], alvo: 0, esperado: 0.5 },
    { nome: "coorte de 2 é neutra (primeiro)", precos: [[1000], [2000]], alvo: 0, esperado: 0.5 },
    { nome: "coorte de 2 é neutra (segundo)", precos: [[1000], [2000]], alvo: 1, esperado: 0.5 },
    { nome: "coorte de 3 distinta: o mais barato", precos: [[1000], [2000], [3000]], alvo: 0, esperado: 1 },
    { nome: "coorte de 3 distinta: o do meio", precos: [[1000], [2000], [3000]], alvo: 1, esperado: 0.5 },
    { nome: "coorte de 3 distinta: o mais caro", precos: [[1000], [2000], [3000]], alvo: 2, esperado: 0 },
    { nome: "três preços iguais ⇒ 0,5 (primeiro)", precos: [[1000], [1000], [1000]], alvo: 0, esperado: 0.5 },
    { nome: "três preços iguais ⇒ 0,5 (último)", precos: [[1000], [1000], [1000]], alvo: 2, esperado: 0.5 },
    { nome: "dois iguais mais baratos numa coorte de 3 (primeiro)", precos: [[1000], [1000], [2000]], alvo: 0, esperado: 0.75 },
    { nome: "dois iguais mais baratos numa coorte de 3 (segundo)", precos: [[1000], [1000], [2000]], alvo: 1, esperado: 0.75 },
    { nome: "dois iguais mais baratos numa coorte de 3 (o mais caro)", precos: [[1000], [1000], [2000]], alvo: 2, esperado: 0 },
    { nome: "preço 0 conta como preço: o mais barato", precos: [[0], [1000], [2000]], alvo: 0, esperado: 1 },
    { nome: "preço 0 conta como preço: o do meio", precos: [[0], [1000], [2000]], alvo: 1, esperado: 0.5 },
    { nome: "dois a 0 Kz mais baratos numa coorte de 3", precos: [[0], [0], [500]], alvo: 0, esperado: 0.75 },
    { nome: "usa o MENOR preço do profissional (5000 e 1000 ⇒ 1000, o mais barato)", precos: [[5000, 1000], [2000], [3000]], alvo: 0, esperado: 1 },
    { nome: "usa o MENOR preço do profissional (o do meio com 2000 e 3000)", precos: [[5000, 1000], [2000], [3000]], alvo: 1, esperado: 0.5 },
    { nome: "coorte de 4 com empate ao meio (1000, 2000, 2000, 3000): o barato", precos: [[1000], [2000], [2000], [3000]], alvo: 0, esperado: 1 },
    { nome: "coorte de 4 com empate ao meio: um dos 2000", precos: [[1000], [2000], [2000], [3000]], alvo: 1, esperado: 0.5 },
    { nome: "coorte de 4 com empate ao meio: o mais caro", precos: [[1000], [2000], [2000], [3000]], alvo: 3, esperado: 0 },
  ])("$nome ⇒ $esperado", ({ precos, alvo, esperado }) => {
    const coorte = coortePorPrecos(precos);
    const entrada = coorte[alvo];
    if (!entrada) throw new Error(`alvo ${String(alvo)} fora da coorte`);
    expect(priceSignal(entrada, coorte)).toBeCloseTo(esperado, 10);
  });
});

describe("(4) antiguidade: dias inteiros desde a aprovação, saturada em 180", () => {
  it.each([
    { nome: "aprovado agora: 0 dias", approvedAtMs: NOW, esperado: 0 },
    { nome: "1 dia", approvedAtMs: NOW - DAY, esperado: 1 / 180 },
    { nome: "1 dia e meio conta como 1 dia inteiro", approvedAtMs: NOW - DAY - DAY / 2, esperado: 1 / 180 },
    { nome: "90 dias", approvedAtMs: NOW - 90 * DAY, esperado: 0.5 },
    { nome: "179 dias", approvedAtMs: NOW - 179 * DAY, esperado: 179 / 180 },
    { nome: "180 dias (limiar de saturação)", approvedAtMs: NOW - 180 * DAY, esperado: 1 },
    { nome: "400 dias (satura em 1)", approvedAtMs: NOW - 400 * DAY, esperado: 1 },
    { nome: "aprovação no futuro (+10 dias) ⇒ 0", approvedAtMs: NOW + 10 * DAY, esperado: 0 },
    { nome: "aprovação no futuro (+1 segundo) ⇒ 0", approvedAtMs: NOW + 1000, esperado: 0 },
  ])("$nome ⇒ $esperado", ({ approvedAtMs, esperado }) => {
    expect(senioritySignal(profissional({ approvedAtMs }), NOW)).toBeCloseTo(esperado, 10);
  });
});

describe("(4b) avaliações: n < 3 ⇒ 0,5; senão (bayes − 1) / 4 com bayes = (5·C + Σ) / (5 + n)", () => {
  it.each([
    { nome: "sem avaliações ⇒ neutro", n: 0, sum: 0, C: 3, esperado: 0.5 },
    { nome: "2 avaliações de 5 ⇒ neutro (abaixo do mínimo)", n: 2, sum: 10, C: 3, esperado: 0.5 },
    { nome: "2 avaliações de 1 ⇒ neutro (sem castigo)", n: 2, sum: 2, C: 3, esperado: 0.5 },
    { nome: "3 de 5, C = 5 ⇒ bayes 5 ⇒ 1", n: 3, sum: 15, C: 5, esperado: 1 },
    { nome: "3 de 1, C = 1 ⇒ bayes 1 ⇒ 0", n: 3, sum: 3, C: 1, esperado: 0 },
    { nome: "3 de 3, C = 3 ⇒ bayes 3 ⇒ 0,5", n: 3, sum: 9, C: 3, esperado: 0.5 },
    { nome: "3 de 5, C = 3 ⇒ bayes (15 + 15)/8 = 3,75 ⇒ 0,6875", n: 3, sum: 15, C: 3, esperado: 0.6875 },
    { nome: "10 de 5, C = 3 ⇒ bayes (15 + 50)/15 ⇒ (4,3333 − 1)/4", n: 10, sum: 50, C: 3, esperado: (65 / 15 - 1) / 4 },
    { nome: "5 com soma 20, C = 4 ⇒ bayes 4 ⇒ 0,75", n: 5, sum: 20, C: 4, esperado: 0.75 },
  ])("$nome", ({ n, sum, C, esperado }) => {
    expect(reviewsSignal(profissional({ reviewCount: n, reviewSum: sum }), C)).toBeCloseTo(esperado, 10);
  });

  it.each([
    { nome: "coorte sem avaliações ⇒ média de reserva 3", notas: [[0, 0], [0, 0]], esperado: 3 },
    { nome: "média ponderada pela contagem (não média das médias): 3 de soma 15 e 7 de soma 21 ⇒ 3,6", notas: [[3, 15], [7, 21]], esperado: 3.6 },
    { nome: "avaliações de uma só pessoa na coorte", notas: [[4, 8], [0, 0]], esperado: 2 },
  ])("C (média da coorte): $nome", ({ notas, esperado }) => {
    expect(cohortMeanRating(notas.map(([reviewCount, reviewSum], i) => profissional({ professionalId: `p${String(i)}`, reviewCount, reviewSum })))).toBeCloseTo(esperado, 10);
  });
});

const sinais = (parcial: Partial<RankingSignalValues> = {}): RankingSignalValues => ({ reviews: 0, profileCompleteness: 0, availability: 0, price: 0, seniority: 0, ...parcial });

describe("(5) pontuação: round(40r + 20c + 20a + 10p + 10s), inteira e em 0..100", () => {
  it.each([
    { nome: "todos os sinais a 0", s: sinais(), esperado: 0 },
    { nome: "todos os sinais a 1", s: { reviews: 1, profileCompleteness: 1, availability: 1, price: 1, seniority: 1 }, esperado: 100 },
    { nome: "todos a 0,5", s: { reviews: 0.5, profileCompleteness: 0.5, availability: 0.5, price: 0.5, seniority: 0.5 }, esperado: 50 },
    { nome: "todos a 0,75", s: { reviews: 0.75, profileCompleteness: 0.75, availability: 0.75, price: 0.75, seniority: 0.75 }, esperado: 75 },
    { nome: "só avaliações a 1 ⇒ 40", s: sinais({ reviews: 1 }), esperado: 40 },
    { nome: "só avaliações neutras ⇒ 20", s: sinais({ reviews: 0.5 }), esperado: 20 },
    { nome: "só preço neutro: 5", s: sinais({ price: 0.5 }), esperado: 5 },
    { nome: "só disponibilidade 0,5: 10", s: sinais({ availability: 0.5 }), esperado: 10 },
    { nome: "avaliações e preço neutros: 25", s: sinais({ reviews: 0.5, price: 0.5 }), esperado: 25 },
    { nome: "preço 0,05 ⇒ 0,5 sobe para 1", s: sinais({ price: 0.05 }), esperado: 1 },
    { nome: "completude 0,25 ⇒ 5", s: sinais({ profileCompleteness: 0.25 }), esperado: 5 },
    { nome: "completude 0,4 + antiguidade de 1 dia: 8,06 desce para 8", s: sinais({ profileCompleteness: 0.4, seniority: 1 / 180 }), esperado: 8 },
    { nome: "disponibilidade 0,01 ⇒ 0,2 desce para 0", s: sinais({ availability: 0.01 }), esperado: 0 },
    { nome: "completude 1 ⇒ 20", s: sinais({ profileCompleteness: 1 }), esperado: 20 },
  ])("$nome ⇒ $esperado", ({ s, esperado }) => {
    expect(scoreOf(s)).toBe(esperado);
  });

  it.each([
    { nome: "coorte de 1, perfil vazio, sem avaliações (20 + 5 = 25)", entrada: profissional(), esperado: 25 },
    { nome: "coorte de 1, 10 horários (25 + 10 = 35)", entrada: profissional({ offers: [oferta({ slotsNext14Days: 10 })] }), esperado: 35 },
    { nome: "coorte de 1, bio com 1 caractere (25 + 4 = 29)", entrada: profissional({ bioLength: 1 }), esperado: 29 },
    { nome: "coorte de 1, 1 horário (25 + 1 = 26)", entrada: profissional({ offers: [oferta({ slotsNext14Days: 1 })] }), esperado: 26 },
    {
      nome: "coorte de 1, tudo no máximo exceto avaliações e preço (20 + 20 + 20 + 5 + 10 = 75)",
      entrada: profissional({
        bioLength: 80,
        offers: [oferta({ method: "IN_PERSON", hasNote: true, slotsNext14Days: 10 }), oferta({ method: "VIDEO", slotsNext14Days: 10 })],
        approvedAtMs: NOW - 180 * DAY,
      }),
      esperado: 75,
    },
    { nome: "coorte de 1, bio completa e 90 dias (20 + 8 + 5 + 5 = 38)", entrada: profissional({ bioLength: 80, approvedAtMs: NOW - 90 * DAY }), esperado: 38 },
    { nome: "coorte de 1, aprovação no futuro (20 + 8 + 5 = 33)", entrada: profissional({ bioLength: 80, approvedAtMs: NOW + 10 * DAY }), esperado: 33 },
    { nome: "coorte de 1, 3 avaliações de 5 (C = 5 ⇒ 40 + 5 = 45)", entrada: profissional({ reviewCount: 3, reviewSum: 15 }), esperado: 45 },
    { nome: "coorte de 1, 3 avaliações de 1 (C = 1 ⇒ 0 + 5 = 5)", entrada: profissional({ reviewCount: 3, reviewSum: 3 }), esperado: 5 },
    { nome: "coorte de 1, 5 avaliações com soma 20 (C = 4 ⇒ 0,75 ⇒ 30 + 5 = 35)", entrada: profissional({ reviewCount: 5, reviewSum: 20 }), esperado: 35 },
    { nome: "coorte de 1, 2 avaliações de 5 ainda são neutras (20 + 5 = 25)", entrada: profissional({ reviewCount: 2, reviewSum: 10 }), esperado: 25 },
  ])("rankProfessionals: $nome", ({ entrada, esperado }) => {
    expect(pontuacaoSozinho(entrada)).toBe(esperado);
  });

  it("coorte de 3 com extremos: 100 para o melhor, 25 para o do meio (avaliações e preço neutros), 20 para o pior; sempre em 0..100", () => {
    const melhor = profissional({
      professionalId: "a",
      bioLength: 200,
      offers: [oferta({ method: "IN_PERSON", priceKz: 1000, hasNote: true, slotsNext14Days: 10 }), oferta({ method: "VIDEO", priceKz: 1500, slotsNext14Days: 10 })],
      approvedAtMs: NOW - 400 * DAY,
      reviewCount: 3,
      reviewSum: 15,
    });
    const meio = profissional({ professionalId: "b", offers: [oferta({ method: "VIDEO", priceKz: 2000 })] });
    const pior = profissional({ professionalId: "c", offers: [oferta({ method: "PHONE", priceKz: 3000 })] });
    const ranking = rankProfessionals([pior, meio, melhor], NOW);
    expect(ranking.map((r) => ({ id: r.professionalId, score: r.score, label: r.label }))).toEqual([
      { id: "a", score: 100, label: "RATED" },
      { id: "b", score: 25, label: "NEW" },
      { id: "c", score: 20, label: "NEW" },
    ]);
    expect(ranking[0]?.signals).toEqual({ reviews: 1, profileCompleteness: 1, availability: 1, price: 1, seniority: 1 });
    for (const r of ranking) {
      expect(Number.isInteger(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("(6) razões: sinal ≥ 0,75 (inclusivo), por ordem de peso, no máximo 3; GOOD_REVIEWS só com n ≥ 3", () => {
  it.each([
    { nome: "todos a 0,74 ⇒ nenhuma razão", s: { reviews: 0.74, profileCompleteness: 0.74, availability: 0.74, price: 0.74, seniority: 0.74 }, esperado: [] },
    { nome: "avaliações a 0,75 ⇒ GOOD_REVIEWS", s: sinais({ reviews: 0.75 }), esperado: ["GOOD_REVIEWS"] },
    { nome: "completude a 0,75 ⇒ COMPLETE_PROFILE", s: sinais({ profileCompleteness: 0.75 }), esperado: ["COMPLETE_PROFILE"] },
    { nome: "disponibilidade a 0,75 ⇒ GOOD_AVAILABILITY", s: sinais({ availability: 0.75 }), esperado: ["GOOD_AVAILABILITY"] },
    { nome: "preço a 0,75 ⇒ COMPETITIVE_PRICE", s: sinais({ price: 0.75 }), esperado: ["COMPETITIVE_PRICE"] },
    { nome: "antiguidade a 0,75 ⇒ ESTABLISHED", s: sinais({ seniority: 0.75 }), esperado: ["ESTABLISHED"] },
    { nome: "disponibilidade a 0,74 ⇒ nenhuma razão", s: sinais({ availability: 0.74 }), esperado: [] },
    { nome: "ordem por peso, não por valor: antiguidade 1, preço 0,8, disponibilidade 0,76", s: sinais({ profileCompleteness: 0.1, availability: 0.76, price: 0.8, seniority: 1 }), esperado: ["GOOD_AVAILABILITY", "COMPETITIVE_PRICE", "ESTABLISHED"] },
    { nome: "cinco sinais a 0,75 ⇒ máximo de três razões (corta preço e antiguidade)", s: { reviews: 0.75, profileCompleteness: 0.75, availability: 0.75, price: 0.75, seniority: 0.75 }, esperado: ["GOOD_REVIEWS", "COMPLETE_PROFILE", "GOOD_AVAILABILITY"] },
    { nome: "dois sinais altos (preço e antiguidade) ⇒ duas razões", s: sinais({ price: 0.75, seniority: 0.75 }), esperado: ["COMPETITIVE_PRICE", "ESTABLISHED"] },
  ])("$nome", ({ s, esperado }) => {
    expect(reasonsFor(s)).toEqual(esperado);
  });

  it("GOOD_REVIEWS nunca sai com n < 3, mesmo com o sinal alto", () => {
    expect(reasonsFor(sinais({ reviews: 0.9 }), 2)).toEqual([]);
    expect(reasonsFor(sinais({ reviews: 0.9 }), 3)).toEqual(["GOOD_REVIEWS"]);
  });
});

describe("(7) desempate em rankProfessionals: pontuação ↓, avaliações ↓, disponibilidade ↓, aprovação mais antiga, id menor", () => {
  it.each([
    {
      nome: "pontuação manda antes da disponibilidade (45 contra 35)",
      cohort: [
        profissional({ professionalId: "pro-disp", offers: [oferta({ slotsNext14Days: 10 })] }),
        profissional({ professionalId: "pro-alto", bioLength: 80, offers: [oferta({ method: "IN_PERSON", hasNote: true }), oferta({ method: "VIDEO" })] }),
      ],
      ordem: ["pro-alto", "pro-disp"],
    },
    {
      // C = 3: A: (15 + 12)/8 = 3,375 ⇒ 0,59375 ⇒ 23,75; B: (15 + 6)/8 = 2,625 ⇒ 0,40625 ⇒ 16,25 + 8 (8 horários) = 24,25; + 5 de preço: ambos 29.
      nome: "mesma pontuação (29 e 29): mais avaliações primeiro, mesmo com menos disponibilidade",
      cohort: [
        profissional({ professionalId: "pro-b", reviewCount: 3, reviewSum: 6, offers: [oferta({ slotsNext14Days: 8 })] }),
        profissional({ professionalId: "pro-a", reviewCount: 3, reviewSum: 12 }),
      ],
      ordem: ["pro-a", "pro-b"],
    },
    {
      nome: "mesma pontuação (26 e 26) e avaliações iguais: mais disponibilidade primeiro, mesmo sendo a aprovação mais recente",
      cohort: [profissional({ professionalId: "pro-antigo", approvedAtMs: NOW - 18 * DAY }), profissional({ professionalId: "pro-novo", offers: [oferta({ slotsNext14Days: 1 })] })],
      ordem: ["pro-novo", "pro-antigo"],
    },
    {
      nome: "mesma pontuação (35), avaliações e disponibilidade iguais: aprovação mais antiga primeiro, mesmo com id maior",
      cohort: [profissional({ professionalId: "pro-a", approvedAtMs: NOW - 200 * DAY }), profissional({ professionalId: "pro-z", approvedAtMs: NOW - 400 * DAY })],
      ordem: ["pro-z", "pro-a"],
    },
    {
      nome: "tudo igual (25, neutro, 0, mesma aprovação): id menor primeiro",
      cohort: [profissional({ professionalId: "pro-b" }), profissional({ professionalId: "pro-a" })],
      ordem: ["pro-a", "pro-b"],
    },
  ])("$nome", ({ cohort, ordem }) => {
    expect(rankProfessionals(cohort, NOW).map((r) => r.professionalId)).toEqual(ordem);
    expect(rankProfessionals([...cohort].reverse(), NOW).map((r) => r.professionalId)).toEqual(ordem);
  });
});
