// Domínio puro de `record-sharing` (MK4, BR-MKT-67..74; state-machines.md «RecordShare»): prazo, categorias permitidas, estados e
// `canOpen`. Sem I/O, sem relógio próprio (o instante entra por parâmetro) e sem importar nada fora de `domain/` (ADR-016).

export type ShareValidity = "H24" | "D7" | "D30" | "UNTIL_CONSULTATION_END_PLUS_24H";
export const SHARE_VALIDITIES: readonly ShareValidity[] = ["H24", "D7", "D30", "UNTIL_CONSULTATION_END_PLUS_24H"];
export type RecordShareStatus = "ACTIVE" | "REVOKED" | "CONSUMED";
/** Estado derivado devolvido à família (`EXPIRED` nunca é gravado; BR-MKT-69). */
export type RecordShareDerivedStatus = RecordShareStatus | "EXPIRED";
export type DataCategory = "ALLERGIES" | "CONDITIONS" | "MEDICATION" | "APPOINTMENTS" | "EXAMS";
export const DATA_CATEGORIES: readonly DataCategory[] = ["ALLERGIES", "CONDITIONS", "MEDICATION", "APPOINTMENTS", "EXAMS"];
export type ProfessionalCategory = "HEALTH" | "WELLNESS";
export type ShareBookingStatus = "REQUESTED" | "CONFIRMED" | "REJECTED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Limites de MK4 (BR-MKT-69/77): única fonte, para os testes e os casos de uso. */
export const SHARE_LIMITS = {
  /** Prazo máximo de qualquer partilha. */
  maxValidityMs: 30 * DAY_MS,
  /** Partilhas `ACTIVE` por membro. */
  maxActivePerMember: 20,
  /** Criações por dia e por utilizador. */
  maxCreatesPerDay: 20,
  /** Retenção das partilhas terminadas (BR-MKT-76): 24 meses. */
  retentionMonths: 24,
} as const;

/** Categorias partilháveis por categoria do profissional (BR-MKT-68): constante, nunca um `if` por especialidade. */
export const ALLOWED_CATEGORIES: Readonly<Record<ProfessionalCategory, readonly DataCategory[]>> = {
  HEALTH: DATA_CATEGORIES,
  WELLNESS: ["MEDICATION"],
};

export type ShareValidationFailure = "EMPTY" | "DUPLICATE" | "UNKNOWN" | "NOT_ALLOWED";

/** `null` se a escolha é válida para a categoria do profissional; senão o motivo (⇒ `VALIDATION_ERROR`). */
export function validateCategories(professionalCategory: ProfessionalCategory, categories: readonly string[]): ShareValidationFailure | null {
  if (categories.length === 0) return "EMPTY";
  if (new Set(categories).size !== categories.length) return "DUPLICATE";
  if (categories.some((c) => !DATA_CATEGORIES.includes(c as DataCategory))) return "UNKNOWN";
  const allowed = ALLOWED_CATEGORIES[professionalCategory];
  if (categories.some((c) => !allowed.includes(c as DataCategory))) return "NOT_ALLOWED";
  return null;
}

/**
 * `expiresAt` calculado uma só vez, à criação (BR-MKT-69): `agora + 24 h/7 d/30 d` ou `min(endsAt + 24 h, agora + 30 dias)`.
 * Nunca mais de 30 dias. `Africa/Luanda` não tem DST (UTC+1 fixo), pelo que a aritmética em milissegundos é exata.
 * Devolve milissegundos desde a época (o domínio não constrói `Date`); o chamador converte. Lança `RangeError` se `expiresAt <= agora`
 * (marcação terminada há mais de 24 h): o chamador converte em `VALIDATION_ERROR`.
 */
export function computeExpiresAtMs(validity: ShareValidity, now: Date, bookingEndsAt: Date): number {
  const cap = now.getTime() + SHARE_LIMITS.maxValidityMs;
  let target: number;
  switch (validity) {
    case "H24":
      target = now.getTime() + 24 * HOUR_MS;
      break;
    case "D7":
      target = now.getTime() + 7 * DAY_MS;
      break;
    case "D30":
      target = cap;
      break;
    case "UNTIL_CONSULTATION_END_PLUS_24H":
      target = Math.min(bookingEndsAt.getTime() + 24 * HOUR_MS, cap);
      break;
  }
  if (target <= now.getTime()) throw new RangeError("expiresAt tem de ser posterior ao instante atual");
  return target;
}

/** `true` se a opção de prazo ainda é elegível (`expiresAt > agora`); usado por `options` (`eligible`). */
export function isValidityEligible(validity: ShareValidity, now: Date, bookingEndsAt: Date): boolean {
  try {
    computeExpiresAtMs(validity, now, bookingEndsAt);
    return true;
  } catch {
    return false;
  }
}

/** Estado derivado: `EXPIRED` só se `ACTIVE` e `expiresAt <= agora` (os terminais gravados prevalecem). */
export function deriveShareStatus(status: RecordShareStatus, expiresAt: Date, now: Date): RecordShareDerivedStatus {
  if (status === "ACTIVE" && expiresAt.getTime() <= now.getTime()) return "EXPIRED";
  return status;
}

export type ShareOpenDecision = "OPEN" | "NOT_AVAILABLE" | "ALREADY_VIEWED";

export interface ShareOpenFacts {
  status: RecordShareStatus;
  expiresAt: Date;
  professionalApproved: boolean;
  bookingStatus: ShareBookingStatus;
  memberActive: boolean;
  categories: readonly DataCategory[];
  professionalCategory: ProfessionalCategory;
  now: Date;
}

/**
 * BR-MKT-70: reavaliação a cada abertura. `CONSUMED` ⇒ `ALREADY_VIEWED`; qualquer outra falha ⇒ `NOT_AVAILABLE`
 * (o `detail` é genérico e igual para todas as causas). Sem estado próprio: nada é gravado por esta decisão.
 */
export function evaluateOpen(f: ShareOpenFacts): ShareOpenDecision {
  if (f.status === "CONSUMED") return "ALREADY_VIEWED";
  if (f.status !== "ACTIVE") return "NOT_AVAILABLE";
  if (f.expiresAt.getTime() <= f.now.getTime()) return "NOT_AVAILABLE";
  if (!f.professionalApproved) return "NOT_AVAILABLE";
  if (f.bookingStatus !== "CONFIRMED" && f.bookingStatus !== "COMPLETED") return "NOT_AVAILABLE";
  if (!f.memberActive) return "NOT_AVAILABLE";
  if (validateCategories(f.professionalCategory, f.categories) !== null) return "NOT_AVAILABLE";
  return "OPEN";
}

/** `canOpen` do portal (derivado, só metadados): igual à decisão `OPEN`. */
export function canOpen(f: ShareOpenFacts): boolean {
  return evaluateOpen(f) === "OPEN";
}

/** Só `ACTIVE` não expirada se revoga (BR-MKT-74); `false` ⇒ `INVALID_STATE_TRANSITION`. */
export function canRevoke(status: RecordShareStatus, expiresAt: Date, now: Date): boolean {
  return deriveShareStatus(status, expiresAt, now) === "ACTIVE";
}

/** Sinal de criação permitida: marcação `CONFIRMED`/`COMPLETED` (BR-MKT-67). */
export function bookingAllowsSharing(status: ShareBookingStatus): boolean {
  return status === "CONFIRMED" || status === "COMPLETED";
}
