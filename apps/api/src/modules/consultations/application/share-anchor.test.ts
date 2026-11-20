// Factos da marcação-âncora de uma partilha (MK4; BR-MKT-67, BR-MKT-70). Repositório e agenda em stubs escritos à mão.
import { describe, expect, it } from "vitest";
import type { BookingStatus } from "../domain/booking.js";
import type { BookingRecord, BookingRepository, ProfessionalAgenda, SpecialtyCategory } from "./ports.js";
import { createShareAnchor } from "./share-anchor.js";

type Trx = object;

const TRX: Trx = {};
const FAMILY = "family-1";
const MEMBER = "member-1";
const PROFESSIONAL = "professional-1";
const BOOKING = "booking-1";
const SPEC_HEALTH = "spec-health";
const SPEC_WELLNESS = "spec-wellness";
const STARTS = new Date("2026-11-25T09:00:00.000Z");
const ENDS = new Date("2026-11-25T09:45:00.000Z");

const ESPECIALIDADES: { id: string; name: string; category: SpecialtyCategory }[] = [
  { id: SPEC_HEALTH, name: "Clínica geral", category: "HEALTH" },
  { id: SPEC_WELLNESS, name: "Nutrição", category: "WELLNESS" },
];

function buildBooking(overrides: Partial<BookingRecord> = {}): BookingRecord {
  return {
    id: BOOKING,
    familyId: FAMILY,
    memberId: MEMBER,
    professionalId: PROFESSIONAL,
    offerId: "offer-1",
    specialtyId: SPEC_HEALTH,
    method: "VIDEO",
    durationMinutes: 45,
    priceKz: 15000,
    startsAt: STARTS,
    endsAt: ENDS,
    slotId: "slot-1",
    status: "CONFIRMED",
    paymentStatus: "CONFIRMED",
    participantLabel: "Filho",
    statusReason: null,
    cancelledBy: null,
    systemReason: null,
    confirmedAt: STARTS,
    completedAt: null,
    cancelledAt: null,
    meetingInfo: null,
    processId: null,
    createdByUserId: "user-1",
    clientRequestId: null,
    createdAt: STARTS,
    updatedAt: STARTS,
    ...overrides,
  };
}

type FindForFamilyArgs = [trx: Trx, familyId: string, memberId: string, bookingId: string, forUpdate: boolean];
type FindForProfessionalArgs = [trx: Trx, professionalId: string, bookingId: string, forUpdate: boolean];

/** Único sítio com cast: o stub implementa só as duas leituras usadas por `share-anchor`; o resto da porta não é chamado. */
function asBookingRepository(parcial: Pick<BookingRepository<Trx>, "findForFamily" | "findForProfessional">): BookingRepository<Trx> {
  return parcial as unknown as BookingRepository<Trx>;
}

function repositorioStub(marcacoes: BookingRecord[]) {
  const chamadasFamilia: FindForFamilyArgs[] = [];
  const chamadasProfissional: FindForProfessionalArgs[] = [];
  const repo = asBookingRepository({
    findForFamily: (trx, familyId, memberId, bookingId, forUpdate) => {
      chamadasFamilia.push([trx, familyId, memberId, bookingId, forUpdate]);
      const encontrada = marcacoes.find((b) => b.familyId === familyId && b.memberId === memberId && b.id === bookingId);
      return Promise.resolve(encontrada ?? null);
    },
    findForProfessional: (trx, professionalId, bookingId, forUpdate) => {
      chamadasProfissional.push([trx, professionalId, bookingId, forUpdate]);
      const encontrada = marcacoes.find((b) => b.professionalId === professionalId && b.id === bookingId);
      return Promise.resolve(encontrada ?? null);
    },
  });
  return { repo, chamadasFamilia, chamadasProfissional };
}

function agendaStub(especialidades: { id: string; name: string; category: SpecialtyCategory }[]): Pick<ProfessionalAgenda<Trx>, "findSpecialties"> {
  return {
    findSpecialties: (ids) => Promise.resolve(especialidades.filter((e) => ids.includes(e.id))),
  };
}

function montar(marcacoes: BookingRecord[], especialidades = ESPECIALIDADES) {
  const stubs = repositorioStub(marcacoes);
  const servico = createShareAnchor<Trx>({ bookings: stubs.repo, agenda: agendaStub(especialidades) });
  return { servico, chamadasFamilia: stubs.chamadasFamilia, chamadasProfissional: stubs.chamadasProfissional };
}

describe("getAnchorFacts", () => {
  it("devolve os factos da marcação com categoria HEALTH", async () => {
    const { servico } = montar([buildBooking({ specialtyId: SPEC_HEALTH, status: "CONFIRMED" })]);
    await expect(servico.getAnchorFacts(TRX, FAMILY, MEMBER, BOOKING)).resolves.toEqual({
      professionalId: PROFESSIONAL,
      status: "CONFIRMED",
      startsAt: STARTS,
      endsAt: ENDS,
      participantLabel: "Filho",
      professionalCategory: "HEALTH",
    });
  });

  it("devolve professionalCategory WELLNESS quando a especialidade é WELLNESS", async () => {
    const { servico } = montar([buildBooking({ specialtyId: SPEC_WELLNESS, status: "COMPLETED", completedAt: ENDS })]);
    const facts = await servico.getAnchorFacts(TRX, FAMILY, MEMBER, BOOKING);
    expect(facts?.professionalCategory).toBe("WELLNESS");
    expect(facts?.status).toBe("COMPLETED");
  });

  it("procura sempre por (família, membro, id) com forUpdate false e nunca com forUpdate true", async () => {
    const { servico, chamadasFamilia } = montar([buildBooking()]);
    await servico.getAnchorFacts(TRX, FAMILY, MEMBER, BOOKING);
    expect(chamadasFamilia).toEqual([[TRX, FAMILY, MEMBER, BOOKING, false]]);
    expect(chamadasFamilia.some((c) => c[4])).toBe(false);
  });

  it("marcação inexistente ou de outro membro/família devolve null", async () => {
    const { servico } = montar([buildBooking({ memberId: "member-2" })]);
    await expect(servico.getAnchorFacts(TRX, FAMILY, MEMBER, BOOKING)).resolves.toBeNull();
    await expect(servico.getAnchorFacts(TRX, FAMILY, MEMBER, "booking-inexistente")).resolves.toBeNull();
    await expect(servico.getAnchorFacts(TRX, "family-2", MEMBER, BOOKING)).resolves.toBeNull();
  });

  it("especialidade em falta devolve null", async () => {
    const { servico } = montar([buildBooking()], []);
    await expect(servico.getAnchorFacts(TRX, FAMILY, MEMBER, BOOKING)).resolves.toBeNull();
  });

  it("o resultado tem exatamente as chaves dos factos (sem notas, preço, ids de utilizador)", async () => {
    const { servico } = montar([buildBooking()]);
    const facts = await servico.getAnchorFacts(TRX, FAMILY, MEMBER, BOOKING);
    expect(facts).not.toBeNull();
    expect(Object.keys(facts ?? {})).toEqual(["professionalId", "status", "startsAt", "endsAt", "participantLabel", "professionalCategory"]);
  });
});

describe("getAnchorStatus", () => {
  it.each<BookingStatus>(["CONFIRMED", "CANCELLED", "COMPLETED"])("devolve só { status } para %s", async (status) => {
    const { servico } = montar([buildBooking({ status })]);
    const resultado = await servico.getAnchorStatus(TRX, BOOKING, PROFESSIONAL);
    expect(resultado).toEqual({ status });
    expect(Object.keys(resultado ?? {})).toEqual(["status"]);
  });

  it("procura por (profissional, id) com forUpdate false", async () => {
    const { servico, chamadasProfissional } = montar([buildBooking()]);
    await servico.getAnchorStatus(TRX, BOOKING, PROFESSIONAL);
    expect(chamadasProfissional).toEqual([[TRX, PROFESSIONAL, BOOKING, false]]);
  });

  it("marcação de outro profissional devolve null", async () => {
    const { servico } = montar([buildBooking({ professionalId: "professional-2" })]);
    await expect(servico.getAnchorStatus(TRX, BOOKING, PROFESSIONAL)).resolves.toBeNull();
  });
});
