// `ProfessionalDirectory` (BR-MKT-19, OP-65): a ÚNICA forma de outros módulos (MK2 pesquisa, MK3 marcação) lerem profissionais. Filtra
// `APPROVED` em cada leitura (sem cache de estado) e devolve só dados públicos: nunca `paymentInstructions`, e-mail, credenciais nem estado
// de validação. `DRAFT`/`PENDING_REVIEW`/`NEEDS_INFO`/`REJECTED`/`SUSPENDED` são indistinguíveis de «inexistente» (`null`/ausente).
import type { SpecialtyCategory } from "../domain/requirements.js";
import type { DirectoryFilter, ProfessionalsDeps, PublicOffer, SlotRecord } from "./ports.js";

export interface PublicProfessionalProfile {
  id: string;
  displayName: string;
  bio: string | null;
  city: string;
  specialties: { id: string; name: string; category: SpecialtyCategory }[];
  offers: PublicOffer[];
}

export interface DirectoryQuery {
  category?: SpecialtyCategory;
  specialtyId?: string;
  city?: string;
  limit?: number;
  afterId?: string;
}

export interface BookableSlot {
  id: string;
  offerId: string;
  startsAt: Date;
  endsAt: Date;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_SLOT_RANGE_MS = 62 * 24 * 3600 * 1000;

async function hydrate<Trx>(deps: ProfessionalsDeps<Trx>, trx: Trx, rows: { id: string; displayName: string; bio: string | null; city: string }[]): Promise<PublicProfessionalProfile[]> {
  const ids = rows.map((r) => r.id);
  const [specialties, offers] = await Promise.all([deps.adminRepo.listSpecialtiesFor(trx, ids), deps.directoryRepo.activeOffersFor(trx, ids)]);
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    bio: r.bio,
    city: r.city,
    specialties: (specialties.get(r.id) ?? []).map((s) => ({ id: s.id, name: s.name, category: s.category })),
    offers: offers.get(r.id) ?? [],
  }));
}

export function createProfessionalDirectory<Trx>(deps: ProfessionalsDeps<Trx>) {
  return {
    async getApprovedProfile(professionalId: string): Promise<PublicProfessionalProfile | null> {
      return deps.withTransaction(async (trx) => {
        const row = await deps.directoryRepo.findApproved(trx, professionalId);
        if (!row) return null;
        return (await hydrate(deps, trx, [row]))[0] ?? null;
      });
    },

    async listApproved(query: DirectoryQuery = {}): Promise<PublicProfessionalProfile[]> {
      const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
      const filter: DirectoryFilter = {
        limit,
        ...(query.category ? { category: query.category } : {}),
        ...(query.specialtyId ? { specialtyId: query.specialtyId } : {}),
        ...(query.city ? { city: query.city } : {}),
        ...(query.afterId ? { afterId: query.afterId } : {}),
      };
      return deps.withTransaction(async (trx) => hydrate(deps, trx, await deps.directoryRepo.listApproved(trx, filter)));
    },

    /** Horários futuros livres de um APPROVED (só ofertas ativas); `[]` se não está APPROVED; intervalo limitado a 62 dias. */
    async listBookableSlots(professionalId: string, from: Date, to: Date): Promise<BookableSlot[]> {
      if (!(to.getTime() > from.getTime()) || to.getTime() - from.getTime() > MAX_SLOT_RANGE_MS) return [];
      const now = deps.clock.now();
      const slots: SlotRecord[] = await deps.withTransaction((trx) => deps.directoryRepo.bookableSlots(trx, professionalId, from, to, now));
      return slots.map((s) => ({ id: s.id, offerId: s.offerId, startsAt: s.startsAt, endsAt: s.endsAt }));
    },
  };
}

export type ProfessionalDirectory = ReturnType<typeof createProfessionalDirectory>;
