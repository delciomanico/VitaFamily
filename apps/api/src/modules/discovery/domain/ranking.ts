// Ranking `v1` (BR-MKT-36/37, OP-78): FUNÇÃO PURA e explicável sobre a coorte de uma especialidade. Sem I/O, sem relógio próprio (o
// instante vem injetado em milissegundos) e sem leitura de tabelas. O tipo de entrada é FECHADO: só os campos de BR-MKT-37. Nada de
// pagamento, e-mail, nome, cidade, estado de validação, planos, destaques nem ordem manual — um teste confirma as chaves e outro, metamórfico,
// que variar qualquer outro dado do profissional não muda a pontuação nem a ordem. Alterar pesos/limiares é mudança de contrato (nova versão).

/** Configuração versionada do ranking `v1` (única fonte de pesos, limiares e códigos; `GET /marketplace/ranking-rules` deriva daqui). */
export const RANKING_V1 = {
  version: "v1",
  /** Pesos em percentagem; somam 100. */
  weights: { profileCompleteness: 40, availability: 30, price: 15, seniority: 15 },
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

/** Entrada FECHADA do ranking (BR-MKT-37): exatamente estas chaves. `bioLength` é o comprimento da bio já aparada (nunca o texto). */
export interface RankingInput {
  professionalId: string;
  bioLength: number;
  offers: RankingOfferInput[];
  /** Instante da primeira aprovação (epoch ms); não muda com suspensões. */
  approvedAtMs: number;
}

/** Chaves permitidas (para o teste de fecho do tipo). */
export const RANKING_INPUT_KEYS = ["professionalId", "bioLength", "offers", "approvedAtMs"] as const;
export const RANKING_OFFER_INPUT_KEYS = ["method", "priceKz", "hasNote", "slotsNext14Days"] as const;

export type RankingReasonCode = "COMPLETE_PROFILE" | "GOOD_AVAILABILITY" | "COMPETITIVE_PRICE" | "ESTABLISHED";

export interface RankingSignalValues {
  profileCompleteness: number;
  availability: number;
  price: number;
  seniority: number;
}

export interface RankingResult {
  professionalId: string;
  version: typeof RANKING_V1.version;
  /** Inteiro 0–100: `round(100·Σ peso·sinal)`. */
  score: number;
  signals: RankingSignalValues;
  reasons: RankingReasonCode[];
  /** `NEW` enquanto não existirem avaliações verificadas (MK3, BR-MKT-04). */
  label: "NEW";
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
  const c = RANKING_V1.completeness;
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
  return Math.min(slots, RANKING_V1.availability.saturationSlots) / RANKING_V1.availability.saturationSlots;
}

/** Menor preço ativo do profissional na especialidade (`Infinity` se não tem ofertas; fora da coorte). */
function minPrice(input: RankingInput): number {
  return input.offers.reduce((min, o) => Math.min(min, o.priceKz), Number.POSITIVE_INFINITY);
}

/** (c) Preço em [0,1]: percentil relativo na coorte (mais barato ⇒ mais alto); neutro com coorte < 3. `iguais` inclui o próprio. */
export function priceSignal(input: RankingInput, cohort: readonly RankingInput[]): number {
  const n = cohort.length;
  if (n < RANKING_V1.price.minCohort) return RANKING_V1.price.neutral;
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
  return Math.min(days, RANKING_V1.seniority.saturationDays) / RANKING_V1.seniority.saturationDays;
}

const REASON_ORDER: readonly [keyof RankingSignalValues, RankingReasonCode][] = [
  ["profileCompleteness", "COMPLETE_PROFILE"],
  ["availability", "GOOD_AVAILABILITY"],
  ["price", "COMPETITIVE_PRICE"],
  ["seniority", "ESTABLISHED"],
];

/** Sinais ≥ 0,75 por ordem de peso, no máximo 3. */
export function reasonsFor(signals: RankingSignalValues): RankingReasonCode[] {
  return REASON_ORDER.filter(([key]) => signals[key] >= RANKING_V1.reasons.threshold)
    .map(([, code]) => code)
    .slice(0, RANKING_V1.reasons.max);
}

/** Pontuação inteira 0–100; o `+1e-9` só protege empates exatos em `x,5` do erro de vírgula flutuante. */
export function scoreOf(signals: RankingSignalValues): number {
  const w = RANKING_V1.weights;
  const total = w.profileCompleteness * signals.profileCompleteness + w.availability * signals.availability + w.price * signals.price + w.seniority * signals.seniority;
  return Math.min(100, Math.max(0, Math.round(total + 1e-9)));
}

/** Ordem do ranking: pontuação ↓, disponibilidade ↓, aprovação mais antiga, id menor. */
export function compareRanking(a: RankingResult, b: RankingResult): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.signals.availability !== b.signals.availability) return b.signals.availability - a.signals.availability;
  if (a.approvedAtMs !== b.approvedAtMs) return a.approvedAtMs - b.approvedAtMs;
  return a.professionalId < b.professionalId ? -1 : a.professionalId > b.professionalId ? 1 : 0;
}

/**
 * Ranking `v1` da coorte de UMA especialidade (profissionais `APPROVED` com ≥ 1 oferta ativa nela). Devolve a coorte ordenada.
 * Determinístico e independente da ordem de entrada; a pontuação não depende de filtros do pedido (a coorte é a da especialidade inteira).
 */
export function rankProfessionals(cohort: readonly RankingInput[], nowMs: number): RankingResult[] {
  const members = cohort.filter((c) => c.offers.length > 0);
  return members
    .map((input): RankingResult => {
      const raw: RankingSignalValues = {
        profileCompleteness: completenessSignal(input),
        availability: availabilitySignal(input),
        price: priceSignal(input, members),
        seniority: senioritySignal(input, nowMs),
      };
      const signals: RankingSignalValues = {
        profileCompleteness: round4(raw.profileCompleteness),
        availability: round4(raw.availability),
        price: round4(raw.price),
        seniority: round4(raw.seniority),
      };
      return {
        professionalId: input.professionalId,
        version: RANKING_V1.version,
        score: scoreOf(raw),
        signals,
        reasons: reasonsFor(raw),
        label: "NEW",
        approvedAtMs: input.approvedAtMs,
      };
    })
    .sort(compareRanking);
}
