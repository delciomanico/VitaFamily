// Domínio de `record-sharing` (TC-MKT-117/118/119; BR-MKT-67..74; state-machines.md «RecordShare»).
import { describe, expect, it } from "vitest";
import {
  ALLOWED_CATEGORIES,
  DATA_CATEGORIES,
  SHARE_LIMITS,
  SHARE_VALIDITIES,
  bookingAllowsSharing,
  canOpen,
  canRevoke,
  computeExpiresAtMs,
  deriveShareStatus,
  evaluateOpen,
  isValidityEligible,
  validateCategories,
  type DataCategory,
  type ProfessionalCategory,
  type RecordShareStatus,
  type ShareBookingStatus,
  type ShareOpenDecision,
  type ShareOpenFacts,
} from "./share.js";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = new Date("2031-03-10T10:00:00Z");
const NOW_MS = NOW.getTime();
const CAP_MS = NOW_MS + 30 * DAY;
const at = (ms: number): Date => new Date(ms);

describe("computeExpiresAtMs: prazos (TC-MKT-117)", () => {
  it.each([
    ["H24", NOW_MS + 24 * HOUR],
    ["D7", NOW_MS + 7 * DAY],
    ["D30", NOW_MS + 30 * DAY],
  ] as const)("%s = agora + prazo exato", (validity, esperado) => {
    expect(computeExpiresAtMs(validity, NOW, at(NOW_MS + 56 * DAY))).toBe(esperado);
  });

  it("UNTIL_CONSULTATION_END_PLUS_24H = endsAt + 24h quando não excede 30 dias", () => {
    const endsAt = NOW_MS + 2 * DAY;
    expect(computeExpiresAtMs("UNTIL_CONSULTATION_END_PLUS_24H", NOW, at(endsAt))).toBe(endsAt + 24 * HOUR);
  });

  it("marcação a 8 semanas (endsAt = agora + 56 d) => teto de 30 dias", () => {
    expect(computeExpiresAtMs("UNTIL_CONSULTATION_END_PLUS_24H", NOW, at(NOW_MS + 56 * DAY))).toBe(CAP_MS);
  });

  it("endsAt = agora + 6 d 23 h => endsAt + 24h = agora + 7 d 23 h", () => {
    const endsAt = NOW_MS + 6 * DAY + 23 * HOUR;
    expect(computeExpiresAtMs("UNTIL_CONSULTATION_END_PLUS_24H", NOW, at(endsAt))).toBe(NOW_MS + 7 * DAY + 23 * HOUR);
  });

  it("marcação terminada há 24 h + 1 ms => RangeError", () => {
    const endsAt = NOW_MS - 24 * HOUR - 1;
    expect(() => computeExpiresAtMs("UNTIL_CONSULTATION_END_PLUS_24H", NOW, at(endsAt))).toThrow(RangeError);
  });

  it("marcação terminada exatamente há 24 h (expiresAt == agora) => RangeError", () => {
    const endsAt = NOW_MS - 24 * HOUR;
    expect(() => computeExpiresAtMs("UNTIL_CONSULTATION_END_PLUS_24H", NOW, at(endsAt))).toThrow(RangeError);
  });

  it("marcação terminada há 23 h 59 min => aceite (expiresAt 1 min depois de agora)", () => {
    const endsAt = NOW_MS - 23 * HOUR - 59 * 60_000;
    expect(computeExpiresAtMs("UNTIL_CONSULTATION_END_PLUS_24H", NOW, at(endsAt))).toBe(NOW_MS + 60_000);
  });

  it("fronteira horária de Luanda (UTC+1 fixo): ISO com +01:00 é instante absoluto", () => {
    const endsAt = new Date("2031-03-30T23:30:00+01:00");
    expect(endsAt.getTime()).toBe(Date.parse("2031-03-30T22:30:00Z"));
    expect(computeExpiresAtMs("UNTIL_CONSULTATION_END_PLUS_24H", NOW, endsAt)).toBe(Date.parse("2031-03-31T22:30:00Z"));
  });

  const endsAtSamples: readonly number[] = [
    NOW_MS - 25 * HOUR,
    NOW_MS - 24 * HOUR,
    NOW_MS,
    NOW_MS + DAY,
    NOW_MS + 6 * DAY + 23 * HOUR,
    NOW_MS + 56 * DAY,
    NOW_MS + 1000 * DAY,
  ];
  const combinacoes = SHARE_VALIDITIES.flatMap((validity) => endsAtSamples.map((endsAt) => [validity, endsAt] as const));

  it.each(combinacoes)("%s com endsAt=%i nunca excede agora + 30 dias (ou lança RangeError)", (validity, endsAt) => {
    try {
      const expiresAt = computeExpiresAtMs(validity, NOW, at(endsAt));
      expect(expiresAt).toBeGreaterThan(NOW_MS);
      expect(expiresAt).toBeLessThanOrEqual(CAP_MS);
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
    }
  });

  it.each([
    ["H24", NOW_MS - 25 * HOUR, true],
    ["D7", NOW_MS - 25 * HOUR, true],
    ["D30", NOW_MS - 25 * HOUR, true],
    ["UNTIL_CONSULTATION_END_PLUS_24H", NOW_MS - 24 * HOUR - 1, false],
    ["UNTIL_CONSULTATION_END_PLUS_24H", NOW_MS - 24 * HOUR, false],
    ["UNTIL_CONSULTATION_END_PLUS_24H", NOW_MS - 23 * HOUR, true],
  ] as const)("isValidityEligible(%s, endsAt=%i) => %s", (validity, endsAt, esperado) => {
    expect(isValidityEligible(validity, NOW, at(endsAt))).toBe(esperado);
  });

  it.each(combinacoes)("isValidityEligible coerente com computeExpiresAtMs (%s, %i)", (validity, endsAt) => {
    let lancou = false;
    try {
      computeExpiresAtMs(validity, NOW, at(endsAt));
    } catch {
      lancou = true;
    }
    expect(isValidityEligible(validity, NOW, at(endsAt))).toBe(!lancou);
  });
});

describe("validateCategories (TC-MKT-118; BR-MKT-68)", () => {
  it.each(DATA_CATEGORIES.map((c) => [c] as const))("HEALTH aceita %s isolada", (c) => {
    expect(validateCategories("HEALTH", [c])).toBeNull();
  });

  it("HEALTH aceita as 5 categorias juntas", () => {
    expect(validateCategories("HEALTH", [...DATA_CATEGORIES])).toBeNull();
  });

  it("HEALTH aceita um subconjunto de 2", () => {
    expect(validateCategories("HEALTH", ["ALLERGIES", "EXAMS"])).toBeNull();
  });

  it("WELLNESS aceita [MEDICATION]", () => {
    expect(validateCategories("WELLNESS", ["MEDICATION"])).toBeNull();
  });

  it.each(DATA_CATEGORIES.filter((c) => c !== "MEDICATION").map((c) => [c] as const))("WELLNESS rejeita %s => NOT_ALLOWED", (c) => {
    expect(validateCategories("WELLNESS", [c])).toBe("NOT_ALLOWED");
  });

  it("WELLNESS com [MEDICATION, EXAMS] => NOT_ALLOWED", () => {
    expect(validateCategories("WELLNESS", ["MEDICATION", "EXAMS"])).toBe("NOT_ALLOWED");
  });

  it("lista vazia => EMPTY", () => {
    expect(validateCategories("HEALTH", [])).toBe("EMPTY");
  });

  it("categoria repetida => DUPLICATE", () => {
    expect(validateCategories("HEALTH", ["EXAMS", "EXAMS"])).toBe("DUPLICATE");
  });

  it("categoria desconhecida => UNKNOWN", () => {
    expect(validateCategories("HEALTH", ["FOO"])).toBe("UNKNOWN");
  });

  it("constantes: HEALTH tem 5 categorias, WELLNESS só MEDICATION", () => {
    expect(ALLOWED_CATEGORIES.HEALTH).toHaveLength(5);
    expect(ALLOWED_CATEGORIES.WELLNESS).toEqual(["MEDICATION"]);
  });
});

describe("deriveShareStatus e canRevoke (TC-MKT-119; BR-MKT-69/74)", () => {
  const EXPIRES_FUTURE = at(NOW_MS + HOUR);
  const EXPIRES_NOW = at(NOW_MS);
  const EXPIRES_PAST = at(NOW_MS - HOUR);

  it.each([
    ["ACTIVE", EXPIRES_FUTURE, "ACTIVE"],
    ["ACTIVE", EXPIRES_NOW, "EXPIRED"],
    ["ACTIVE", EXPIRES_PAST, "EXPIRED"],
    ["REVOKED", EXPIRES_PAST, "REVOKED"],
    ["REVOKED", EXPIRES_FUTURE, "REVOKED"],
    ["CONSUMED", EXPIRES_PAST, "CONSUMED"],
    ["CONSUMED", EXPIRES_NOW, "CONSUMED"],
    ["CONSUMED", EXPIRES_FUTURE, "CONSUMED"],
  ] as const)("deriveShareStatus(%s, expiresAt) => %s", (status, expiresAt, esperado) => {
    expect(deriveShareStatus(status, expiresAt, NOW)).toBe(esperado);
  });

  it("canRevoke: só ACTIVE não expirada => true", () => {
    expect(canRevoke("ACTIVE", EXPIRES_FUTURE, NOW)).toBe(true);
    expect(canRevoke("ACTIVE", EXPIRES_NOW, NOW)).toBe(false);
    expect(canRevoke("REVOKED", EXPIRES_FUTURE, NOW)).toBe(false);
    expect(canRevoke("CONSUMED", EXPIRES_FUTURE, NOW)).toBe(false);
  });
});

describe("evaluateOpen / canOpen: tabela completa (TC-MKT-119; BR-MKT-70)", () => {
  const STATUSES: readonly RecordShareStatus[] = ["ACTIVE", "REVOKED", "CONSUMED"];
  const BOOKINGS: readonly ShareBookingStatus[] = ["CONFIRMED", "COMPLETED", "REQUESTED", "REJECTED", "CANCELLED", "NO_SHOW"];
  const BOOLEANS: readonly boolean[] = [true, false];

  // Oráculo independente da implementação: descreve a regra de BR-MKT-70 por extenso.
  function oraculo(status: RecordShareStatus, expirada: boolean, aprovado: boolean, marcacao: ShareBookingStatus, membroAtivo: boolean): ShareOpenDecision {
    if (status === "CONSUMED") return "ALREADY_VIEWED";
    const marcacaoOk = marcacao === "CONFIRMED" || marcacao === "COMPLETED";
    const abrir = status === "ACTIVE" && !expirada && aprovado && marcacaoOk && membroAtivo;
    return abrir ? "OPEN" : "NOT_AVAILABLE";
  }

  function facts(
    status: RecordShareStatus,
    expirada: boolean,
    aprovado: boolean,
    marcacao: ShareBookingStatus,
    membroAtivo: boolean,
    categories: readonly DataCategory[] = ["ALLERGIES"],
    professionalCategory: ProfessionalCategory = "HEALTH",
  ): ShareOpenFacts {
    return {
      status,
      expiresAt: at(expirada ? NOW_MS - HOUR : NOW_MS + HOUR),
      professionalApproved: aprovado,
      bookingStatus: marcacao,
      memberActive: membroAtivo,
      categories,
      professionalCategory,
      now: NOW,
    };
  }

  const combinacoes = STATUSES.flatMap((status) =>
    BOOLEANS.flatMap((expirada) =>
      BOOLEANS.flatMap((aprovado) =>
        BOOKINGS.flatMap((marcacao) => BOOLEANS.map((membroAtivo) => [status, expirada, aprovado, marcacao, membroAtivo] as const)),
      ),
    ),
  );

  it.each(combinacoes)(
    "%s, expirada=%s, aprovado=%s, marcação=%s, membroAtivo=%s",
    (status, expirada, aprovado, marcacao, membroAtivo) => {
      const f = facts(status, expirada, aprovado, marcacao, membroAtivo);
      const esperado = oraculo(status, expirada, aprovado, marcacao, membroAtivo);
      expect(evaluateOpen(f)).toBe(esperado);
      expect(canOpen(f)).toBe(esperado === "OPEN");
    },
  );

  it("WELLNESS com [EXAMS] => NOT_AVAILABLE (categoria deixou de ser permitida)", () => {
    expect(evaluateOpen(facts("ACTIVE", false, true, "CONFIRMED", true, ["EXAMS"], "WELLNESS"))).toBe("NOT_AVAILABLE");
  });

  it("WELLNESS com [MEDICATION] => OPEN", () => {
    const f = facts("ACTIVE", false, true, "CONFIRMED", true, ["MEDICATION"], "WELLNESS");
    expect(evaluateOpen(f)).toBe("OPEN");
    expect(canOpen(f)).toBe(true);
  });

  it("expiresAt === now => NOT_AVAILABLE", () => {
    const f: ShareOpenFacts = { ...facts("ACTIVE", false, true, "CONFIRMED", true), expiresAt: NOW };
    expect(evaluateOpen(f)).toBe("NOT_AVAILABLE");
    expect(canOpen(f)).toBe(false);
  });

  it("CONSUMED é ALREADY_VIEWED mesmo com expiresAt passado e marcação cancelada", () => {
    const f = facts("CONSUMED", true, false, "CANCELLED", false);
    expect(evaluateOpen(f)).toBe("ALREADY_VIEWED");
    expect(canOpen(f)).toBe(false);
  });
});

describe("bookingAllowsSharing (BR-MKT-67)", () => {
  it.each([
    ["CONFIRMED", true],
    ["COMPLETED", true],
    ["REQUESTED", false],
    ["REJECTED", false],
    ["CANCELLED", false],
    ["NO_SHOW", false],
  ] as const)("%s => %s", (status, esperado) => {
    expect(bookingAllowsSharing(status)).toBe(esperado);
  });
});

describe("SHARE_LIMITS", () => {
  it("valores de MK4", () => {
    expect(SHARE_LIMITS.maxActivePerMember).toBe(20);
    expect(SHARE_LIMITS.maxCreatesPerDay).toBe(20);
    expect(SHARE_LIMITS.maxValidityMs).toBe(30 * DAY);
  });
});
