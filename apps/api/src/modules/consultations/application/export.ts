// Marcações de um membro para a exportação do titular (BR-MKT-64, UC-MKT-47, TC-MKT-101). Mesma autorização da família (`BOOK_PROFESSIONALS`:
// só SELF/TUTOR_OF; relação insuficiente ⇒ lança e o `lifecycle` omite a secção). Só o que o titular já vê: estado, oferta, preço, datas,
// `participantLabel`, metadados dos comprovativos (NUNCA o ficheiro nem a chave) e a sua avaliação. Sem ids de utilizador nem do profissional.
import type { ActorIdentity, ConsultationsDeps } from "./ports.js";

const PAGE = 100;

export function createExportBookings<Trx>(deps: Pick<ConsultationsDeps<Trx>, "withTransaction" | "access" | "agenda" | "bookings" | "proofs" | "reviews">) {
  return async function exportBookings(actor: ActorIdentity, familyId: string, memberId: string): Promise<Record<string, unknown>[]> {
    return deps.withTransaction(async (trx) => {
      await deps.access.assertCanBook(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
      const records = [];
      let after: { startsAt: Date; id: string } | undefined;
      for (;;) {
        const rows = await deps.bookings.listForMember(trx, familyId, memberId, { limit: PAGE, ...(after ? { after } : {}) });
        records.push(...rows);
        const last = rows.at(-1);
        if (rows.length < PAGE || !last) break;
        after = { startsAt: last.startsAt, id: last.id };
      }
      if (records.length === 0) return [];
      const [identities, specialties] = await Promise.all([
        deps.agenda.findIdentities([...new Set(records.map((r) => r.professionalId))]),
        deps.agenda.findSpecialties([...new Set(records.map((r) => r.specialtyId))]),
      ]);
      const result: Record<string, unknown>[] = [];
      for (const b of records) {
        const identity = identities.find((i) => i.id === b.professionalId);
        const specialty = specialties.find((s) => s.id === b.specialtyId);
        const proofs = await deps.proofs.listForBooking(trx, b.id);
        const review = await deps.reviews.findByBooking(trx, b.id, false);
        result.push({
          id: b.id,
          status: b.status,
          paymentStatus: b.paymentStatus,
          professional: identity ? { displayName: identity.displayName, city: identity.city } : null,
          specialty: specialty?.name ?? null,
          method: b.method,
          durationMinutes: b.durationMinutes,
          priceKz: b.priceKz,
          startsAt: b.startsAt.toISOString(),
          endsAt: b.endsAt.toISOString(),
          participantLabel: b.participantLabel,
          createdAt: b.createdAt.toISOString(),
          // Metadados apenas: o ficheiro e a chave de armazenamento nunca entram no pacote.
          paymentProofs: proofs
            .filter((p) => p.scanStatus !== "INFECTED")
            .map((p) => ({ id: p.id, status: p.status, contentType: p.contentType, sizeBytes: p.sizeBytes, createdAt: p.createdAt.toISOString(), decidedAt: p.decidedAt?.toISOString() ?? null, purged: p.purgedAt !== null })),
          review: review
            ? { rating: review.rating, comment: review.commentHiddenAt ? null : review.comment, reply: review.replyText, consultedMonth: review.consultedMonth, createdAt: review.createdAt.toISOString() }
            : null,
        });
      }
      return result;
    });
  };
}
