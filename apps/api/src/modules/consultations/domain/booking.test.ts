// Máquina de estados e janelas da marcação (TC-MKT-82; BR-MKT-51..54; state-machines.md «Booking»).
import { describe, expect, it } from "vitest";
import {
  BOOKING_LIMITS,
  BOOKING_STATUSES,
  checkBookingAction,
  checkBookingLead,
  initialPaymentStatus,
  intervalsOverlap,
  isActiveBooking,
  isCancelledLate,
  isRequestExpired,
  isTerminalBooking,
  meetingInfoRequired,
  transitionEffects,
  type BookingAction,
  type BookingStatus,
} from "./booking.js";

const NOW = Date.UTC(2026, 10, 19, 10, 0);
const H = 3_600_000;
const FUTURE = NOW + 5 * H;
const PAST = NOW - H;
const ACTIONS: BookingAction[] = ["CONFIRM", "REJECT", "CANCEL_BY_FAMILY", "CANCEL_BY_PROFESSIONAL", "CANCEL_BY_SYSTEM", "COMPLETE", "NO_SHOW"];

describe("checkBookingAction: tabela total estado × ação (BR-MKT-52)", () => {
  // Estado futuro (startsAt = FUTURE): ✓ = destino; ✗ = INVALID_STATE; TOO_EARLY/TOO_LATE pelas regras horárias.
  const futuro: Record<BookingStatus, Record<BookingAction, string>> = {
    REQUESTED: { CONFIRM: "CONFIRMED", REJECT: "REJECTED", CANCEL_BY_FAMILY: "CANCELLED", CANCEL_BY_PROFESSIONAL: "CANCELLED", CANCEL_BY_SYSTEM: "CANCELLED", COMPLETE: "INVALID_STATE", NO_SHOW: "INVALID_STATE" },
    CONFIRMED: { CONFIRM: "INVALID_STATE", REJECT: "INVALID_STATE", CANCEL_BY_FAMILY: "CANCELLED", CANCEL_BY_PROFESSIONAL: "CANCELLED", CANCEL_BY_SYSTEM: "CANCELLED", COMPLETE: "TOO_EARLY", NO_SHOW: "TOO_EARLY" },
    REJECTED: { CONFIRM: "INVALID_STATE", REJECT: "INVALID_STATE", CANCEL_BY_FAMILY: "INVALID_STATE", CANCEL_BY_PROFESSIONAL: "INVALID_STATE", CANCEL_BY_SYSTEM: "INVALID_STATE", COMPLETE: "INVALID_STATE", NO_SHOW: "INVALID_STATE" },
    CANCELLED: { CONFIRM: "INVALID_STATE", REJECT: "INVALID_STATE", CANCEL_BY_FAMILY: "INVALID_STATE", CANCEL_BY_PROFESSIONAL: "INVALID_STATE", CANCEL_BY_SYSTEM: "INVALID_STATE", COMPLETE: "INVALID_STATE", NO_SHOW: "INVALID_STATE" },
    COMPLETED: { CONFIRM: "INVALID_STATE", REJECT: "INVALID_STATE", CANCEL_BY_FAMILY: "INVALID_STATE", CANCEL_BY_PROFESSIONAL: "INVALID_STATE", CANCEL_BY_SYSTEM: "INVALID_STATE", COMPLETE: "INVALID_STATE", NO_SHOW: "INVALID_STATE" },
    NO_SHOW: { CONFIRM: "INVALID_STATE", REJECT: "INVALID_STATE", CANCEL_BY_FAMILY: "INVALID_STATE", CANCEL_BY_PROFESSIONAL: "INVALID_STATE", CANCEL_BY_SYSTEM: "INVALID_STATE", COMPLETE: "INVALID_STATE", NO_SHOW: "INVALID_STATE" },
  };
  const cases = BOOKING_STATUSES.flatMap((status) => ACTIONS.map((action) => [status, action, futuro[status][action]] as const));

  it.each(cases)("%s + %s (hora futura) => %s", (status, action, esperado) => {
    const r = checkBookingAction({ status, startsAtMs: FUTURE }, action, NOW);
    expect(r.ok ? r.to : r.reason).toBe(esperado);
  });

  it("totalidade: 6 estados × 7 ações = 42 combinações, todas com resposta", () => {
    expect(cases).toHaveLength(42);
  });

  it("terminais não têm saída, nem sequer com a hora passada (sem correção em MK3, OP-108)", () => {
    for (const status of ["REJECTED", "CANCELLED", "COMPLETED", "NO_SHOW"] as const) {
      expect(isTerminalBooking(status)).toBe(true);
      for (const action of ACTIONS) expect(checkBookingAction({ status, startsAtMs: PAST }, action, NOW)).toEqual({ ok: false, reason: "INVALID_STATE" });
    }
  });

  it("família e profissional cancelam só ANTES de startsAt (TOO_LATE no instante e depois); o sistema cancela sempre", () => {
    for (const action of ["CANCEL_BY_FAMILY", "CANCEL_BY_PROFESSIONAL"] as const) {
      expect(checkBookingAction({ status: "CONFIRMED", startsAtMs: NOW }, action, NOW)).toEqual({ ok: false, reason: "TOO_LATE" });
      expect(checkBookingAction({ status: "REQUESTED", startsAtMs: PAST }, action, NOW)).toEqual({ ok: false, reason: "TOO_LATE" });
      expect(checkBookingAction({ status: "CONFIRMED", startsAtMs: NOW + 1 }, action, NOW)).toEqual({ ok: true, to: "CANCELLED" });
    }
    expect(checkBookingAction({ status: "REQUESTED", startsAtMs: PAST }, "CANCEL_BY_SYSTEM", NOW)).toEqual({ ok: true, to: "CANCELLED" });
  });

  it("concluir e falta só com agora ≥ startsAt (no próprio instante já vale)", () => {
    for (const action of ["COMPLETE", "NO_SHOW"] as const) {
      expect(checkBookingAction({ status: "CONFIRMED", startsAtMs: NOW + 1 }, action, NOW)).toEqual({ ok: false, reason: "TOO_EARLY" });
      expect(checkBookingAction({ status: "CONFIRMED", startsAtMs: NOW }, action, NOW).ok).toBe(true);
      expect(checkBookingAction({ status: "CONFIRMED", startsAtMs: PAST }, action, NOW).ok).toBe(true);
    }
  });

  it("confirmar e recusar não dependem da hora (a hora passada trata-a o job de expiração)", () => {
    expect(checkBookingAction({ status: "REQUESTED", startsAtMs: PAST }, "CONFIRM", NOW).ok).toBe(true);
    expect(checkBookingAction({ status: "REQUESTED", startsAtMs: PAST }, "REJECT", NOW).ok).toBe(true);
  });
});

describe("efeitos das transições (mesma transação)", () => {
  it.each([
    ["REQUESTED", { releaseSlot: false, createAppointment: false, updateAppointment: false }],
    ["CONFIRMED", { releaseSlot: false, createAppointment: true, updateAppointment: false }],
    ["REJECTED", { releaseSlot: true, createAppointment: false, updateAppointment: false }],
    ["CANCELLED", { releaseSlot: true, createAppointment: false, updateAppointment: true }],
    ["COMPLETED", { releaseSlot: false, createAppointment: false, updateAppointment: true }],
    ["NO_SHOW", { releaseSlot: false, createAppointment: false, updateAppointment: true }],
  ] as const)("para %s", (to, esperado) => {
    expect(transitionEffects(to)).toEqual(esperado);
  });
});

describe("criação: antecedência, sobreposição, pagamento inicial (BR-MKT-51/56)", () => {
  it.each([
    { nome: "1 ms antes das 2 h", startsAt: NOW + 2 * H - 1, esperado: "TOO_SOON" },
    { nome: "exatamente 2 h", startsAt: NOW + 2 * H, esperado: "OK" },
    { nome: "no passado", startsAt: PAST, esperado: "TOO_SOON" },
    { nome: "exatamente 8 semanas", startsAt: NOW + 56 * 24 * H, esperado: "OK" },
    { nome: "8 semanas + 1 ms", startsAt: NOW + 56 * 24 * H + 1, esperado: "TOO_FAR" },
  ])("antecedência: $nome => $esperado", ({ startsAt, esperado }) => {
    expect(checkBookingLead(startsAt, NOW)).toBe(esperado);
  });

  it.each([
    { nome: "sobrepostos", a: [0, 30], b: [15, 45], esperado: true },
    { nome: "contidos", a: [0, 60], b: [10, 20], esperado: true },
    { nome: "encostados não sobrepõem", a: [0, 30], b: [30, 60], esperado: false },
    { nome: "separados", a: [0, 30], b: [40, 60], esperado: false },
    { nome: "iguais", a: [0, 30], b: [0, 30], esperado: true },
  ])("intervalos semiabertos: $nome => $esperado", ({ a, b, esperado }) => {
    expect(intervalsOverlap(a[0] ?? 0, a[1] ?? 0, b[0] ?? 0, b[1] ?? 0)).toBe(esperado);
    expect(intervalsOverlap(b[0] ?? 0, b[1] ?? 0, a[0] ?? 0, a[1] ?? 0)).toBe(esperado);
  });

  it("pagamento inicial: 0 Kz => NOT_REQUIRED; > 0 => AWAITING_PROOF", () => {
    expect(initialPaymentStatus(0)).toBe("NOT_REQUIRED");
    expect(initialPaymentStatus(1)).toBe("AWAITING_PROOF");
    expect(initialPaymentStatus(25_000)).toBe("AWAITING_PROOF");
  });

  it("ativas = REQUESTED/CONFIRMED; limites são os do contrato", () => {
    expect(BOOKING_STATUSES.filter(isActiveBooking)).toEqual(["REQUESTED", "CONFIRMED"]);
    expect(BOOKING_LIMITS).toMatchObject({ maxActivePerMember: 10, maxCreatesPerDay: 10, requestExpiryMs: 48 * H, lateCancelMs: 24 * H, reviewWindowMs: 30 * 24 * H, reviewEditWindowMs: 7 * 24 * H });
  });

  it.each([
    ["IN_PERSON", false],
    ["CHAT", false],
    ["VIDEO", true],
    ["PHONE", true],
  ] as const)("meetingInfo obrigatório em %s => %s", (method, esperado) => {
    expect(meetingInfoRequired(method)).toBe(esperado);
  });
});

describe("cancelledLate e expiração (BR-MKT-52/54)", () => {
  const starts = NOW + 100 * H;
  it.each([
    { nome: "família a 24 h exatas não é tardio", cancelledBy: "FAMILY", at: starts - 24 * H, esperado: false },
    { nome: "família a 24 h - 1 ms é tardio", cancelledBy: "FAMILY", at: starts - 24 * H + 1, esperado: true },
    { nome: "família a 1 h é tardio", cancelledBy: "FAMILY", at: starts - H, esperado: true },
    { nome: "profissional nunca é «tardio» (só a família)", cancelledBy: "PROFESSIONAL", at: starts - H, esperado: false },
    { nome: "sistema nunca é «tardio»", cancelledBy: "SYSTEM", at: starts - H, esperado: false },
    { nome: "sem cancelamento", cancelledBy: null, at: null, esperado: false },
  ] as const)("$nome", ({ cancelledBy, at, esperado }) => {
    expect(isCancelledLate({ cancelledBy, cancelledAtMs: at, startsAtMs: starts })).toBe(esperado);
  });

  it.each([
    { nome: "REQUESTED com 47 h59", status: "REQUESTED", created: NOW - 48 * H + 1, starts: FUTURE, esperado: false },
    { nome: "REQUESTED com 48 h", status: "REQUESTED", created: NOW - 48 * H, starts: FUTURE, esperado: true },
    { nome: "REQUESTED com a hora passada", status: "REQUESTED", created: NOW - H, starts: PAST, esperado: true },
    { nome: "REQUESTED a começar agora", status: "REQUESTED", created: NOW - H, starts: NOW, esperado: true },
    { nome: "CONFIRMED nunca caduca por falta de resposta", status: "CONFIRMED", created: NOW - 100 * H, starts: PAST, esperado: false },
  ] as const)("$nome => $esperado", ({ status, created, starts: s, esperado }) => {
    expect(isRequestExpired({ status, createdAtMs: created, startsAtMs: s }, NOW)).toBe(esperado);
  });
});
