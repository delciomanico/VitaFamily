// Formas de saída da descoberta (exatamente os campos de `MarketplaceProfessionalItem`/`Profile`/`ComparisonItem`… do openapi.yaml).
// Só dados públicos: nunca e-mail, `paymentInstructions`, credenciais, estado de validação nem contagens internas (BR-MKT-34).
import type { FactsOffer, FactsSpecialty } from "../domain/facts.js";
import type { RankingResult, RankingSignalValues } from "../domain/ranking.js";
import type { OfferMethodCode } from "../domain/ranking.js";

export interface OfferView {
  id: string;
  specialtyId: string;
  method: OfferMethodCode;
  durationMinutes: number;
  priceKz: number;
  note: string | null;
}

export interface SpecialtyView {
  id: string;
  name: string;
  category: "HEALTH" | "WELLNESS";
}

export interface RankingView {
  version: string;
  score: number;
  signals: RankingSignalValues;
  reasons: RankingResult["reasons"];
  label: RankingResult["label"];
}

export interface ReviewSummaryView {
  count: number;
  /** Uma casa decimal, só com `count ≥ 3` (senão nulo, «Novo»; BR-MKT-61). */
  averageRating: number | null;
}

export function reviewSummaryView(agg: { count: number; sum: number } | undefined): ReviewSummaryView {
  const count = agg?.count ?? 0;
  return { count, averageRating: agg && count >= 3 ? Math.round((agg.sum / count) * 10) / 10 : null };
}

export function offerView(o: FactsOffer): OfferView {
  return { id: o.id, specialtyId: o.specialtyId, method: o.method, durationMinutes: o.durationMinutes, priceKz: o.priceKz, note: o.note };
}

export function specialtyView(s: FactsSpecialty): SpecialtyView {
  return { id: s.id, name: s.name, category: s.category };
}

/** Copia só os campos públicos (`approvedAtMs` é interno: desempate/cursor). */
export function rankingView(r: RankingResult): RankingView {
  return { version: r.version, score: r.score, signals: { ...r.signals }, reasons: [...r.reasons], label: r.label };
}
