// `ProfessionalDirectory` (BR-MKT-19, OP-65): a ÚNICA forma de outros módulos (MK2 pesquisa, MK3 marcação) lerem profissionais. Filtra
// `APPROVED` em cada leitura (sem cache de estado) e devolve só dados públicos: nunca `paymentInstructions`, e-mail, credenciais nem estado
// de validação. `DRAFT`/`PENDING_REVIEW`/`NEEDS_INFO`/`REJECTED`/`SUSPENDED` são indistinguíveis de «inexistente» (`null`/ausente).
import type { SpecialtyCategory } from "../domain/requirements.js";
import type { ApprovedFactsRow, BookingFactsRow, DirectoryFilter, FactsFilter, ProfessionalsDeps, PublicOffer, SlotRecord } from "./ports.js";

export interface PublicProfessionalProfile {
  id: string;
  displayName: string;
  bio: string | null;
  city: string;
  specialties: { id: string; name: string; category: SpecialtyCategory }[];
  offers: PublicOffer[];
}

/** Factos para a descoberta (MK2, `modules.md` nota 36(b)): só `APPROVED`, só ofertas ativas, nunca e-mail/`paymentInstructions`/credenciais/estado. */
export interface ProfessionalFacts {
  id: string;
  displayName: string;
  city: string;
  bio: string | null;
  /** Primeira aprovação (não muda com suspensões). */
  approvedAt: Date;
  /** `active` (aditivo, MK2 S4): `discovery` só lista nos filtros as especialidades ativas (BR-MKT-33). */
  specialties: { id: string; name: string; category: SpecialtyCategory; active: boolean }[];
  offers: PublicOffer[];
  slotStats: { offerId: string; nextSlotAt: Date | null; countNext14Days: number }[];
}

export interface FactsQuery {
  specialtyId?: string;
  category?: SpecialtyCategory;
}

/** Teto técnico por pedido (BR-MKT-49). */
export const MAX_FACTS = 1000;

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

type HydratedProfile = Omit<PublicProfessionalProfile, "specialties"> & { specialties: { id: string; name: string; category: SpecialtyCategory; active: boolean }[] };

async function hydrate<Trx>(deps: ProfessionalsDeps<Trx>, trx: Trx, rows: { id: string; displayName: string; bio: string | null; city: string }[]): Promise<HydratedProfile[]> {
  const ids = rows.map((r) => r.id);
  const [specialties, offers] = await Promise.all([deps.adminRepo.listSpecialtiesFor(trx, ids), deps.directoryRepo.activeOffersFor(trx, ids)]);
  return rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    bio: r.bio,
    city: r.city,
    specialties: (specialties.get(r.id) ?? []).map((s) => ({ id: s.id, name: s.name, category: s.category, active: s.active })),
    offers: offers.get(r.id) ?? [],
  }));
}

function toPublic(profile: HydratedProfile): PublicProfessionalProfile {
  return { ...profile, specialties: profile.specialties.map((s) => ({ id: s.id, name: s.name, category: s.category })) };
}

async function hydrateFacts<Trx>(deps: ProfessionalsDeps<Trx>, trx: Trx, rows: ApprovedFactsRow[]): Promise<ProfessionalFacts[]> {
  const base = await hydrate(deps, trx, rows);
  const slotStats = await deps.directoryRepo.slotStatsFor(trx, rows.map((r) => r.id), deps.clock.now());
  return base.flatMap((profile, i) => {
    const row = rows[i];
    if (!row) return [];
    return [
      {
        id: profile.id,
        displayName: profile.displayName,
        city: profile.city,
        bio: profile.bio,
        approvedAt: row.approvedAt,
        specialties: profile.specialties,
        offers: profile.offers,
        slotStats: (slotStats.get(profile.id) ?? []).map((s) => ({ offerId: s.offerId, nextSlotAt: s.nextSlotAt, countNext14Days: s.countNext14Days })),
      },
    ];
  });
}

export function createProfessionalDirectory<Trx>(deps: ProfessionalsDeps<Trx>) {
  return {
    async getApprovedProfile(professionalId: string): Promise<PublicProfessionalProfile | null> {
      return deps.withTransaction(async (trx) => {
        const row = await deps.directoryRepo.findApproved(trx, professionalId);
        if (!row) return null;
        const profile = (await hydrate(deps, trx, [row]))[0];
        return profile ? toPublic(profile) : null;
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
      return deps.withTransaction(async (trx) => (await hydrate(deps, trx, await deps.directoryRepo.listApproved(trx, filter))).map(toPublic));
    },

    /** M18 (BR-AI-05/09): especialidades `HEALTH` ativas do catálogo — a lista fechada de que o assistente pode sugerir uma. Só id e nome. */
    async listHealthSpecialties(): Promise<{ id: string; name: string }[]> {
      const rows = await deps.specialtyRepo.list(deps.db, { activeOnly: true });
      return rows.filter((row) => row.category === "HEALTH").map((row) => ({ id: row.id, name: row.name }));
    },

    /** MK2 (BR-MKT-41): e-mail da conta SÓ para o aviso genérico de nova mensagem (porta `ProfessionalLookup` de `messaging`); `null` se não existe. */
    async getNotificationEmail(professionalId: string): Promise<string | null> {
      return deps.withTransaction((trx) => deps.directoryRepo.findNotificationEmail(trx, professionalId));
    },

    /** MK2 (BR-MKT-47): identidades públicas (nome, cidade, `approved` lido agora) para o histórico de conversas; ausentes omitidos; teto `MAX_FACTS`. */
    async getConversationIdentities(ids: readonly string[]): Promise<{ id: string; displayName: string; city: string | null; approved: boolean }[]> {
      const unique = [...new Set(ids)].slice(0, MAX_FACTS);
      return deps.withTransaction((trx) => deps.directoryRepo.findConversationIdentities(trx, unique));
    },

    /** MK2: factos da coorte `APPROVED` (opcionalmente por especialidade/categoria), ordenados por id, no máximo `MAX_FACTS`; lido em cada chamada. */
    async listApprovedFacts(query: FactsQuery = {}): Promise<ProfessionalFacts[]> {
      const filter: FactsFilter = { limit: MAX_FACTS, ...(query.specialtyId ? { specialtyId: query.specialtyId } : {}), ...(query.category ? { category: query.category } : {}) };
      return deps.withTransaction(async (trx) => hydrateFacts(deps, trx, await deps.directoryRepo.listApprovedForFacts(trx, filter)));
    },

    /** MK2: factos dos ids pedidos que estão `APPROVED` (ids repetidos ignorados; ausentes/não aprovados omitidos; teto `MAX_FACTS`), por ordem de id. */
    async getApprovedFacts(ids: readonly string[]): Promise<ProfessionalFacts[]> {
      const unique = [...new Set(ids)].slice(0, MAX_FACTS);
      return deps.withTransaction(async (trx) => hydrateFacts(deps, trx, await deps.directoryRepo.listApprovedForFacts(trx, { ids: unique, limit: MAX_FACTS })));
    },

    /** Horários futuros livres de um APPROVED (só ofertas ativas); `[]` se não está APPROVED; intervalo limitado a 62 dias. */
    async listBookableSlots(professionalId: string, from: Date, to: Date): Promise<BookableSlot[]> {
      if (!(to.getTime() > from.getTime()) || to.getTime() - from.getTime() > MAX_SLOT_RANGE_MS) return [];
      const now = deps.clock.now();
      const slots: SlotRecord[] = await deps.withTransaction((trx) => deps.directoryRepo.bookableSlots(trx, professionalId, from, to, now));
      return slots.map((s) => ({ id: s.id, offerId: s.offerId, startsAt: s.startsAt, endsAt: s.endsAt }));
    },

    /** MK3 (UC-MKT-27): oferta ativa e horário de um APPROVED lidos agora; `null` se a oferta/profissional não servem; `slot: null` se o horário não existe. */
    async getBookingFacts(offerId: string, slotId: string): Promise<BookingFactsRow | null> {
      return deps.withTransaction((trx) => deps.directoryRepo.findBookingFacts(trx, offerId, slotId));
    },

    /** MK3 (BR-MKT-53): reserva atómica NA transação do chamador (como `ProcessLinker.open`); falso ⇒ `SLOT_UNAVAILABLE`. */
    async reserveSlot(trx: Trx, input: { bookingId: string; slotId: string; offerId: string; minStart: Date }): Promise<boolean> {
      return deps.directoryRepo.reserveSlot(trx, input);
    },

    /** MK3: liberta o horário da marcação NA transação do chamador (rejeitar/cancelar). */
    async releaseSlot(trx: Trx, bookingId: string): Promise<boolean> {
      return deps.directoryRepo.releaseSlot(trx, bookingId);
    },

    /** MK3: nome/categoria das especialidades (catálogo público) para as vistas de marcação. */
    async findSpecialties(ids: readonly string[]): Promise<{ id: string; name: string; category: SpecialtyCategory }[]> {
      const unique = [...new Set(ids)].slice(0, MAX_FACTS);
      return deps.withTransaction((trx) => deps.directoryRepo.findSpecialties(trx, unique));
    },

    /** MK3 (BR-MKT-26/56): ÚNICA via por que `paymentInstructions` sai de `professionals` (só `consultations`, só em `CONFIRMED`/`COMPLETED`). */
    async readPaymentInstructions(professionalId: string): Promise<string | null> {
      return deps.withTransaction((trx) => deps.directoryRepo.findPaymentInstructions(trx, professionalId));
    },
  };
}

/** O tipo concreto (com a transação do composition root) exporta-se em `index.ts`. */
export type ProfessionalDirectoryOf<Trx> = ReturnType<typeof createProfessionalDirectory<Trx>>;
