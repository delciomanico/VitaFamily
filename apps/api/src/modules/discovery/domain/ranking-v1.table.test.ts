// Ranking v1: tabelas de casos numéricos (TC-MKT-44). Os valores esperados foram calculados à mão a partir de BR-MKT-37, sem copiar a
// fórmula de `ranking.ts`. Os sinais testam-se diretamente (casos 1 a 4); a pontuação, as razões e o desempate testam-se a partir de
// `scoreOf`, `reasonsFor` e `rankProfessionals` (casos 5 a 7). As propriedades gerais (determinismo, metamórficos) estão em `ranking.test.ts`.
import { describe, expect, it } from "vitest";
import {
  availabilitySignal,
  completenessSignal,
  priceSignal,
  rankProfessionals,
  reasonsFor,
  scoreOf,
  senioritySignal,
  type RankingInput,
  type RankingOfferInput,
  type RankingSignalValues,
} from "./ranking-v1.js";

const NOW = Date.UTC(2026, 10, 17, 10, 0);
const DAY = 86_400_000;

/** Oferta de base (VIDEO, 1000 Kz, sem nota, 0 horários); os campos indicados substituem os de base. */
function oferta(campos: Partial<RankingOfferInput> = {}): RankingOfferInput {
  return { method: "VIDEO", priceKz: 1000, hasNote: false, slotsNext14Days: 0, ...campos };
}

/** Profissional de base (bio vazia, uma oferta de base, aprovado agora); os campos indicados substituem os de base. */
function profissional(campos: Partial<RankingInput> = {}): RankingInput {
  return { professionalId: "pro", bioLength: 0, offers: [oferta()], approvedAtMs: NOW, ...campos };
}

/** Coorte em que cada profissional tem ofertas com os preços indicados (o id é `p0`, `p1`, ...). */
function coortePorPrecos(precos: number[][]): RankingInput[] {
  return precos.map((ofertas, i) => profissional({ professionalId: `p${String(i)}`, offers: ofertas.map((priceKz) => oferta({ priceKz })) }));
}

/** Pontuação de uma coorte de uma só entrada (a entrada é a única, logo o preço é neutro e vale 0,5). */
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

describe("(5) pontuação: round(40c + 30a + 15p + 15s), inteira e em 0..100", () => {
  it.each([
    { nome: "todos os sinais a 0", c: 0, a: 0, p: 0, s: 0, esperado: 0 },
    { nome: "todos os sinais a 1", c: 1, a: 1, p: 1, s: 1, esperado: 100 },
    { nome: "todos a 0,5", c: 0.5, a: 0.5, p: 0.5, s: 0.5, esperado: 50 },
    { nome: "todos a 0,75", c: 0.75, a: 0.75, p: 0.75, s: 0.75, esperado: 75 },
    { nome: "só preço neutro: 7,5 sobe para 8", c: 0, a: 0, p: 0.5, s: 0, esperado: 8 },
    { nome: "só disponibilidade 0,5: 15", c: 0, a: 0.5, p: 0, s: 0, esperado: 15 },
    { nome: "disponibilidade 0,5 + preço 0,5: 22,5 sobe para 23", c: 0, a: 0.5, p: 0.5, s: 0, esperado: 23 },
    { nome: "completude 0,4 + preço 0,5 + antiguidade 0,5: 31", c: 0.4, a: 0, p: 0.5, s: 0.5, esperado: 31 },
    { nome: "completude 0,2 + antiguidade de 1 dia: 8,08 desce para 8", c: 0.2, a: 0, p: 0, s: 1 / 180, esperado: 8 },
    { nome: "disponibilidade 0,01 ⇒ 0,3 desce para 0", c: 0, a: 0.01, p: 0, s: 0, esperado: 0 },
    { nome: "completude 1 ⇒ 40", c: 1, a: 0, p: 0, s: 0, esperado: 40 },
  ])("$nome ⇒ $esperado", ({ c, a, p, s, esperado }) => {
    const sinais: RankingSignalValues = { profileCompleteness: c, availability: a, price: p, seniority: s };
    expect(scoreOf(sinais)).toBe(esperado);
  });

  it.each([
    {
      nome: "coorte de 1, perfil vazio (7,5 ⇒ 8)",
      entrada: profissional({ bioLength: 0, offers: [oferta()] }),
      esperado: 8,
    },
    {
      nome: "coorte de 1, 10 horários (15 + 7,5 = 22,5 ⇒ 23)",
      entrada: profissional({ bioLength: 0, offers: [oferta({ slotsNext14Days: 10 })] }),
      esperado: 23,
    },
    {
      nome: "coorte de 1, bio com 1 caractere (8 + 7,5 = 15,5 ⇒ 16)",
      entrada: profissional({ bioLength: 1, offers: [oferta()] }),
      esperado: 16,
    },
    {
      nome: "coorte de 1, tudo no máximo (40 + 30 + 7,5 + 15 = 92,5 ⇒ 93)",
      entrada: profissional({
        bioLength: 80,
        offers: [oferta({ method: "IN_PERSON", hasNote: true, slotsNext14Days: 10 }), oferta({ method: "VIDEO", slotsNext14Days: 10 })],
        approvedAtMs: NOW - 180 * DAY,
      }),
      esperado: 93,
    },
    {
      nome: "coorte de 1, bio completa e 90 dias (16 + 7,5 + 7,5 = 31)",
      entrada: profissional({ bioLength: 80, offers: [oferta()], approvedAtMs: NOW - 90 * DAY }),
      esperado: 31,
    },
    {
      nome: "coorte de 1, aprovação no futuro (16 + 7,5 = 23,5 ⇒ 24)",
      entrada: profissional({ bioLength: 80, offers: [oferta()], approvedAtMs: NOW + 10 * DAY }),
      esperado: 24,
    },
    {
      nome: "coorte de 1, 1 horário (1,5 + 7,5 = 9)",
      entrada: profissional({ bioLength: 0, offers: [oferta({ slotsNext14Days: 1 })] }),
      esperado: 9,
    },
  ])("rankProfessionals: $nome", ({ entrada, esperado }) => {
    expect(pontuacaoSozinho(entrada)).toBe(esperado);
  });

  it("coorte de 3 com extremos: 100 para o melhor, 8 para o do meio (preço 0,5), 0 para o pior; sempre em 0..100", () => {
    const melhor = profissional({
      professionalId: "a",
      bioLength: 200,
      offers: [oferta({ method: "IN_PERSON", priceKz: 1000, hasNote: true, slotsNext14Days: 10 }), oferta({ method: "VIDEO", priceKz: 1500, slotsNext14Days: 10 })],
      approvedAtMs: NOW - 400 * DAY,
    });
    const meio = profissional({ professionalId: "b", bioLength: 0, offers: [oferta({ method: "VIDEO", priceKz: 2000 })] });
    const pior = profissional({ professionalId: "c", bioLength: 0, offers: [oferta({ method: "PHONE", priceKz: 3000 })] });
    const ranking = rankProfessionals([pior, meio, melhor], NOW);
    expect(ranking.map((r) => ({ id: r.professionalId, score: r.score }))).toEqual([
      { id: "a", score: 100 },
      { id: "b", score: 8 },
      { id: "c", score: 0 },
    ]);
    expect(ranking[0]?.signals).toEqual({ profileCompleteness: 1, availability: 1, price: 1, seniority: 1 });
    for (const r of ranking) {
      expect(Number.isInteger(r.score)).toBe(true);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("(6) razões: sinal ≥ 0,75 (inclusivo), por ordem de peso, no máximo 3", () => {
  it.each([
    { nome: "todos a 0,74 ⇒ nenhuma razão", sinais: { profileCompleteness: 0.74, availability: 0.74, price: 0.74, seniority: 0.74 }, esperado: [] },
    { nome: "completude a 0,75 ⇒ COMPLETE_PROFILE", sinais: { profileCompleteness: 0.75, availability: 0, price: 0, seniority: 0 }, esperado: ["COMPLETE_PROFILE"] },
    { nome: "disponibilidade a 0,75 ⇒ GOOD_AVAILABILITY", sinais: { profileCompleteness: 0, availability: 0.75, price: 0, seniority: 0 }, esperado: ["GOOD_AVAILABILITY"] },
    { nome: "preço a 0,75 ⇒ COMPETITIVE_PRICE", sinais: { profileCompleteness: 0, availability: 0, price: 0.75, seniority: 0 }, esperado: ["COMPETITIVE_PRICE"] },
    { nome: "antiguidade a 0,75 ⇒ ESTABLISHED", sinais: { profileCompleteness: 0, availability: 0, price: 0, seniority: 0.75 }, esperado: ["ESTABLISHED"] },
    { nome: "disponibilidade a 0,74 ⇒ nenhuma razão", sinais: { profileCompleteness: 0, availability: 0.74, price: 0, seniority: 0 }, esperado: [] },
    { nome: "preço a 0,74 e antiguidade a 0,74 ⇒ nenhuma razão", sinais: { profileCompleteness: 0, availability: 0, price: 0.74, seniority: 0.74 }, esperado: [] },
    {
      nome: "ordem por peso, não por valor: antiguidade 1, preço 0,8, disponibilidade 0,76",
      sinais: { profileCompleteness: 0.1, availability: 0.76, price: 0.8, seniority: 1 },
      esperado: ["GOOD_AVAILABILITY", "COMPETITIVE_PRICE", "ESTABLISHED"],
    },
    {
      nome: "quatro sinais altos com preço a 0,5 ⇒ três razões (sem COMPETITIVE_PRICE)",
      sinais: { profileCompleteness: 1, availability: 1, price: 0.5, seniority: 1 },
      esperado: ["COMPLETE_PROFILE", "GOOD_AVAILABILITY", "ESTABLISHED"],
    },
    {
      nome: "quatro sinais a 0,75 ⇒ máximo de três razões (corta ESTABLISHED)",
      sinais: { profileCompleteness: 0.75, availability: 0.75, price: 0.75, seniority: 0.75 },
      esperado: ["COMPLETE_PROFILE", "GOOD_AVAILABILITY", "COMPETITIVE_PRICE"],
    },
    {
      nome: "dois sinais altos (preço e antiguidade) ⇒ duas razões",
      sinais: { profileCompleteness: 0.5, availability: 0.5, price: 0.75, seniority: 0.75 },
      esperado: ["COMPETITIVE_PRICE", "ESTABLISHED"],
    },
  ])("$nome", ({ sinais, esperado }) => {
    expect(reasonsFor(sinais)).toEqual(esperado);
  });
});

describe("(7) desempate em rankProfessionals: pontuação ↓, disponibilidade ↓, aprovação mais antiga, id menor", () => {
  it.each([
    {
      nome: "pontuação manda antes da disponibilidade (48 contra 38)",
      cohort: [
        profissional({
          professionalId: "pro-disp",
          bioLength: 0,
          offers: [oferta({ slotsNext14Days: 20 })],
        }),
        profissional({
          professionalId: "pro-alto",
          bioLength: 80,
          offers: [oferta({ method: "IN_PERSON", hasNote: true }), oferta({ method: "VIDEO" })],
        }),
      ],
      ordem: ["pro-alto", "pro-disp"],
    },
    {
      nome: "mesma pontuação (9 e 9): mais disponibilidade primeiro, mesmo sendo a aprovação mais recente",
      cohort: [
        profissional({ professionalId: "pro-antigo", approvedAtMs: NOW - 18 * DAY }),
        profissional({ professionalId: "pro-novo", offers: [oferta({ slotsNext14Days: 1 })] }),
      ],
      ordem: ["pro-novo", "pro-antigo"],
    },
    {
      nome: "mesma pontuação (23) e disponibilidade (0): aprovação mais antiga primeiro, mesmo com id maior",
      cohort: [
        profissional({ professionalId: "pro-a", approvedAtMs: NOW - 200 * DAY }),
        profissional({ professionalId: "pro-z", approvedAtMs: NOW - 400 * DAY }),
      ],
      ordem: ["pro-z", "pro-a"],
    },
    {
      nome: "tudo igual (23, 0, mesma aprovação): id menor primeiro",
      cohort: [profissional({ professionalId: "pro-b" }), profissional({ professionalId: "pro-a" })],
      ordem: ["pro-a", "pro-b"],
    },
  ])("$nome", ({ cohort, ordem }) => {
    expect(rankProfessionals(cohort, NOW).map((r) => r.professionalId)).toEqual(ordem);
    expect(rankProfessionals([...cohort].reverse(), NOW).map((r) => r.professionalId)).toEqual(ordem);
  });
});
