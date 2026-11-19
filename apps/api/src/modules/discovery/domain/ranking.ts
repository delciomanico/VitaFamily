// Ranking `v2` (BR-MKT-36/37/61, OP-103): FUNÇÃO PURA e explicável sobre a coorte de uma especialidade. Sem I/O, sem relógio próprio (o
// instante vem injetado em milissegundos) e sem leitura de tabelas. O tipo de entrada é FECHADO: só os campos de BR-MKT-37 e as agregações
// de avaliações verificadas de BR-MKT-61 (`reviewCount`, `reviewSum`; nunca textos nem ids de família). Nada de pagamento, e-mail, nome,
// cidade, estado de validação, planos, destaques nem ordem manual — um teste confirma as chaves e outro, metamórfico, que variar qualquer
// outro dado do profissional não muda a pontuação nem a ordem. Alterar pesos/limiares é mudança de contrato (nova versão).
// O ficheiro não importa nada (domínio puro); `ranking-v1.ts` guarda a versão anterior só para testes de regressão.

/** Configuração versionada do ranking `v2` (única fonte de pesos, limiares e códigos; `GET /marketplace/ranking-rules` deriva daqui). */
export const RANKING_V2 = {
  version: "v2",
  /** Pesos em percentagem; somam 100. */
  weights: { reviews: 40, profileCompleteness: 20, availability: 20, price: 10, seniority: 10 },
  /** (e) avaliações: mínimo `N` para deixar de ser «Novo», peso `m` da média da coorte (suavização bayesiana), neutro e média de reserva. */
  reviews: { minCount: 3, priorWeight: 5, neutral: 0.5, fallbackMean: 3 },
  /** (a) completude: pontos sobre 100. */
  completeness: { bioFullChars: 80, bioFullPoints: 40, bioPartialPoints: 20, notePoints: 20, multipleMethodsPoints: 20, multipleOffersPoints: 20 },
  /** (b) disponibilidade: janela (dias) já aplicada pela fonte dos horários e saturação. */
  availability: { windowDays: 14, saturationSlots: 20 },
  /** (c) preço: com menos profissionais na coorte o sinal é neutro. */
  price: { minCohort: 3, neutral: 0.5 },
  /** (d) antiguidade: saturação em dias. */
  seniority: { saturationDays: 180 },
  /** Sinal mínimo para gerar uma razão; máximo de razões. */
  reasons: { threshold: 0.75, max: 3 },
} as const;

export type OfferMethodCode = "IN_PERSON" | "VIDEO" | "CHAT" | "PHONE";

/** Oferta ativa do profissional NA especialidade ranqueada (só os campos permitidos). */
export interface RankingOfferInput {
  method: OfferMethodCode;
  priceKz: number;
  /** A oferta tem nota (não o texto da nota). */
  hasNote: boolean;
  /** Horários futuros livres desta oferta nos próximos `availability.windowDays` dias. */
  slotsNext14Days: number;
}

/** Entrada FECHADA do ranking: exatamente estas chaves. `bioLength` é o comprimento da bio já aparada (nunca o texto). */
export interface RankingInput {
  professionalId: string;
  bioLength: number;
  offers: RankingOfferInput[];
  /** Instante da primeira aprovação (epoch ms); não muda com suspensões. */
  approvedAtMs: number;
  /** Nº de avaliações verificadas das marcações de ofertas desta especialidade (a nota conta com o comentário oculto). */
  reviewCount: number;
  /** Soma das notas (1–5) dessas avaliações. */
  reviewSum: number;
}

/** Chaves permitidas (para o teste de fecho do tipo). */
export const RANKING_INPUT_KEYS = ["professionalId", "bioLength", "offers", "approvedAtMs", "reviewCount", "reviewSum"] as const;
export const RANKING_OFFER_INPUT_KEYS = ["method", "priceKz", "hasNote", "slotsNext14Days"] as const;

export type RankingReasonCode = "GOOD_REVIEWS" | "COMPLETE_PROFILE" | "GOOD_AVAILABILITY" | "COMPETITIVE_PRICE" | "ESTABLISHED";

export interface RankingSignalValues {
  reviews: number;
  profileCompleteness: number;
  availability: number;
  price: number;
  seniority: number;
}

export interface RankingResult {
  professionalId: string;
  version: typeof RANKING_V2.version;
  /** Inteiro 0–100: `round(100·Σ peso·sinal)`. */
  score: number;
  signals: RankingSignalValues;
  reasons: RankingReasonCode[];
  /** `NEW` («Novo») com menos de 3 avaliações verificadas na especialidade; `RATED` com 3 ou mais (BR-MKT-61). */
  label: "NEW" | "RATED";
  /** Só para desempate e cursor; epoch ms. */
  approvedAtMs: number;
}

const DAY_MS = 86_400_000;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function round4(x: number): number {
  return Math.round(x * 10_000) / 10_000;
}

/** (a) Completude em [0,1]: pontos/100. */
export function completenessSignal(input: RankingInput): number {
  const c = RANKING_V2.completeness;
  let points = 0;
  if (input.bioLength >= c.bioFullChars) points += c.bioFullPoints;
  else if (input.bioLength >= 1) points += c.bioPartialPoints;
  if (input.offers.some((o) => o.hasNote)) points += c.notePoints;
  if (new Set(input.offers.map((o) => o.method)).size >= 2) points += c.multipleMethodsPoints;
  if (input.offers.length >= 2) points += c.multipleOffersPoints;
  return points / 100;
}

/** (b) Disponibilidade em [0,1]: `min(horários, 20) / 20`. */
export function availabilitySignal(input: RankingInput): number {
  const slots = input.offers.reduce((sum, o) => sum + Math.max(0, o.slotsNext14Days), 0);
  return Math.min(slots, RANKING_V2.availability.saturationSlots) / RANKING_V2.availability.saturationSlots;
}

/** Menor preço ativo do profissional na especialidade (`Infinity` se não tem ofertas; fora da coorte). */
function minPrice(input: RankingInput): number {
  return input.offers.reduce((min, o) => Math.min(min, o.priceKz), Number.POSITIVE_INFINITY);
}

/** (c) Preço em [0,1]: percentil relativo na coorte (mais barato ⇒ mais alto); neutro com coorte < 3. `iguais` inclui o próprio. */
export function priceSignal(input: RankingInput, cohort: readonly RankingInput[]): number {
  const n = cohort.length;
  if (n < RANKING_V2.price.minCohort) return RANKING_V2.price.neutral;
  const p = minPrice(input);
  let lower = 0;
  let equal = 0;
  for (const other of cohort) {
    const q = minPrice(other);
    if (q < p) lower += 1;
    else if (q === p) equal += 1;
  }
  return clamp01(1 - (lower + 0.5 * (equal - 1)) / (n - 1));
}

/** (d) Antiguidade em [0,1]: `min(dias desde a aprovação, 180) / 180` (dias inteiros; futuro ⇒ 0). */
export function senioritySignal(input: RankingInput, nowMs: number): number {
  const days = Math.max(0, Math.floor((nowMs - input.approvedAtMs) / DAY_MS));
  return Math.min(days, RANKING_V2.seniority.saturationDays) / RANKING_V2.seniority.saturationDays;
}

/** Média das notas de TODA a coorte (`Σ notas / Σ avaliações`); sem avaliações na coorte usa a média de reserva (o valor não influencia: `n < 3` ⇒ neutro). */
export function cohortMeanRating(cohort: readonly RankingInput[]): number {
  let count = 0;
  let sum = 0;
  for (const c of cohort) {
    count += Math.max(0, c.reviewCount);
    sum += Math.max(0, c.reviewSum);
  }
  return count === 0 ? RANKING_V2.reviews.fallbackMean : sum / count;
}

/** (e) Avaliações em [0,1]: `n < 3` ⇒ neutro 0,5; senão `(bayes − 1) / 4` com `bayes = (m·C + Σ) / (m + n)`, `m = 5`, `C` = média da coorte. */
export function reviewsSignal(input: RankingInput, cohortMean: number): number {
  const r = RANKING_V2.reviews;
  if (input.reviewCount < r.minCount) return r.neutral;
  const bayes = (r.priorWeight * cohortMean + input.reviewSum) / (r.priorWeight + input.reviewCount);
  return clamp01((bayes - 1) / 4);
}

const REASON_ORDER: readonly [keyof RankingSignalValues, RankingReasonCode][] = [
  ["reviews", "GOOD_REVIEWS"],
  ["profileCompleteness", "COMPLETE_PROFILE"],
  ["availability", "GOOD_AVAILABILITY"],
  ["price", "COMPETITIVE_PRICE"],
  ["seniority", "ESTABLISHED"],
];

/** Sinais ≥ 0,75 por ordem de peso, no máximo 3; `GOOD_REVIEWS` só com `n ≥ 3` (o neutro nunca chega ao limiar, mas a regra é explícita). */
export function reasonsFor(signals: RankingSignalValues, reviewCount: number = RANKING_V2.reviews.minCount): RankingReasonCode[] {
  return REASON_ORDER.filter(([key]) => signals[key] >= RANKING_V2.reasons.threshold && (key !== "reviews" || reviewCount >= RANKING_V2.reviews.minCount))
    .map(([, code]) => code)
    .slice(0, RANKING_V2.reasons.max);
}

/** Pontuação inteira 0–100; o `+1e-9` só protege empates exatos em `x,5` do erro de vírgula flutuante. */
export function scoreOf(signals: RankingSignalValues): number {
  const w = RANKING_V2.weights;
  const total =
    w.reviews * signals.reviews + w.profileCompleteness * signals.profileCompleteness + w.availability * signals.availability + w.price * signals.price + w.seniority * signals.seniority;
  return Math.min(100, Math.max(0, Math.round(total + 1e-9)));
}

/** Ordem do ranking: pontuação ↓, sinal de avaliações ↓, disponibilidade ↓, aprovação mais antiga, id menor. */
export function compareRanking(a: RankingResult, b: RankingResult): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.signals.reviews !== b.signals.reviews) return b.signals.reviews - a.signals.reviews;
  if (a.signals.availability !== b.signals.availability) return b.signals.availability - a.signals.availability;
  if (a.approvedAtMs !== b.approvedAtMs) return a.approvedAtMs - b.approvedAtMs;
  return a.professionalId < b.professionalId ? -1 : a.professionalId > b.professionalId ? 1 : 0;
}

/**
 * Ranking `v2` da coorte de UMA especialidade (profissionais `APPROVED` com ≥ 1 oferta ativa nela). Devolve a coorte ordenada.
 * Determinístico e independente da ordem de entrada; a pontuação não depende de filtros do pedido (a coorte é a da especialidade inteira).
 */
export function rankProfessionals(cohort: readonly RankingInput[], nowMs: number): RankingResult[] {
  const members = cohort.filter((c) => c.offers.length > 0);
  const mean = cohortMeanRating(members);
  return members
    .map((input): RankingResult => {
      const raw: RankingSignalValues = {
        reviews: reviewsSignal(input, mean),
        profileCompleteness: completenessSignal(input),
        availability: availabilitySignal(input),
        price: priceSignal(input, members),
        seniority: senioritySignal(input, nowMs),
      };
      const signals: RankingSignalValues = {
        reviews: round4(raw.reviews),
        profileCompleteness: round4(raw.profileCompleteness),
        availability: round4(raw.availability),
        price: round4(raw.price),
        seniority: round4(raw.seniority),
      };
      return {
        professionalId: input.professionalId,
        version: RANKING_V2.version,
        score: scoreOf(raw),
        signals,
        reasons: reasonsFor(raw, input.reviewCount),
        label: input.reviewCount >= RANKING_V2.reviews.minCount ? "RATED" : "NEW",
        approvedAtMs: input.approvedAtMs,
      };
    })
    .sort(compareRanking);
}
