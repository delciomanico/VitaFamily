// Factos públicos de um profissional `APPROVED` tal como `discovery` os recebe da porta `ProfessionalCatalog` (BR-MKT-32). Só dados públicos:
// nunca e-mail, `paymentInstructions`, credenciais nem estado de validação. Tipos puros do domínio (sem I/O).
import type { OfferMethodCode } from "./ranking.js";

export type SpecialtyCategoryCode = "HEALTH" | "WELLNESS";

export interface FactsSpecialty {
  id: string;
  name: string;
  category: SpecialtyCategoryCode;
  /** Ausente = ativa. Só as ativas entram nos filtros disponíveis (BR-MKT-33). */
  active?: boolean;
}

/** Oferta ATIVA (as inativas nunca chegam ao domínio). */
export interface FactsOffer {
  id: string;
  specialtyId: string;
  method: OfferMethodCode;
  durationMinutes: number;
  priceKz: number;
  note: string | null;
}

/** Estatística de horários futuros livres de uma oferta (a fonte exclui passados, de ofertas inativas e, em MK3, ocupados). */
export interface FactsSlotStat {
  offerId: string;
  nextSlotAt: Date | null;
  /** Horários futuros livres nos próximos 14 dias. */
  countNext14Days: number;
}

export interface ProfessionalFacts {
  id: string;
  displayName: string;
  city: string;
  bio: string | null;
  approvedAt: Date;
  specialties: FactsSpecialty[];
  offers: FactsOffer[];
  slotStats: FactsSlotStat[];
}

export const METHOD_ORDER: readonly OfferMethodCode[] = ["IN_PERSON", "VIDEO", "CHAT", "PHONE"];

/** Ordem canónica das ofertas: método, duração, preço, id. */
export function compareOffers(a: FactsOffer, b: FactsOffer): number {
  return METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method) || a.durationMinutes - b.durationMinutes || a.priceKz - b.priceKz || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}
