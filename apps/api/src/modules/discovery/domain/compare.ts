// Comparação de preços de 2–3 profissionais para UMA especialidade (BR-MKT-35). Sem estado, sem pontuação do ranking, sem contactos.
// Os erros são códigos de domínio; a application mapeia: COUNT/DUPLICATE/NO_OFFER ⇒ 422 `VALIDATION_ERROR` (campo `ids`); um id inexistente
// ou não APPROVED ⇒ 404 do pedido inteiro (decidido pela application antes de chamar `compareProfessionals`).
import { compareOffers, METHOD_ORDER, type FactsOffer, type ProfessionalFacts } from "./facts.js";
import type { OfferMethodCode } from "./ranking.js";

export const COMPARE_MIN = 2;
export const COMPARE_MAX = 3;

export interface ComparisonItem {
  professionalId: string;
  displayName: string;
  city: string;
  offers: FactsOffer[];
  fromPriceKz: number;
  nextAvailableAt: Date | null;
}

export interface MethodPriceSummary {
  method: OfferMethodCode;
  minPriceKz: number;
  maxPriceKz: number;
  /** TODOS os profissionais com o preço mínimo do método (empates incluídos), pela ordem do pedido. */
  cheapestProfessionalIds: string[];
}

export interface Comparison {
  specialtyId: string;
  items: ComparisonItem[];
  priceSummary: MethodPriceSummary[];
}

export type CompareIdsError = "COUNT" | "DUPLICATE";
export type CompareError = CompareIdsError | "NO_OFFER";

/** 2 a 3 ids distintos. */
export function validateCompareIds(ids: readonly string[]): CompareIdsError | null {
  if (ids.length < COMPARE_MIN || ids.length > COMPARE_MAX) return "COUNT";
  if (new Set(ids).size !== ids.length) return "DUPLICATE";
  return null;
}

/** `facts` na ordem do pedido (a ordem dos itens e dos empates segue-a). Devolve erro se algum profissional não tem oferta ativa na especialidade. */
export function compareProfessionals(facts: readonly ProfessionalFacts[], specialtyId: string, nowMs: number): { ok: true; comparison: Comparison } | { ok: false; error: CompareError; professionalId?: string } {
  const idsError = validateCompareIds(facts.map((f) => f.id));
  if (idsError) return { ok: false, error: idsError };
  const items: ComparisonItem[] = [];
  for (const f of facts) {
    const offers = f.offers.filter((o) => o.specialtyId === specialtyId).sort(compareOffers);
    if (offers.length === 0) return { ok: false, error: "NO_OFFER", professionalId: f.id };
    const next = offers
      .map((o) => f.slotStats.find((s) => s.offerId === o.id)?.nextSlotAt ?? null)
      .filter((d): d is Date => d !== null && d.getTime() > nowMs)
      .map((d) => d.getTime());
    items.push({
      professionalId: f.id,
      displayName: f.displayName,
      city: f.city,
      offers,
      fromPriceKz: Math.min(...offers.map((o) => o.priceKz)),
      nextAvailableAt: next.length === 0 ? null : new Date(Math.min(...next)),
    });
  }
  const priceSummary: MethodPriceSummary[] = [];
  for (const method of METHOD_ORDER) {
    const prices = items.flatMap((item) => item.offers.filter((o) => o.method === method).map((o) => ({ id: item.professionalId, price: o.priceKz })));
    if (prices.length === 0) continue;
    const min = Math.min(...prices.map((p) => p.price));
    priceSummary.push({
      method,
      minPriceKz: min,
      maxPriceKz: Math.max(...prices.map((p) => p.price)),
      cheapestProfessionalIds: [...new Set(prices.filter((p) => p.price === min).map((p) => p.id))],
    });
  }
  return { ok: true, comparison: { specialtyId, items, priceSummary } };
}
