// Vistas das partilhas (openapi `RecordShare`, `ProfessionalShare`, `RecordShareView`): funções puras sobre o registo e os dados já lidos.
// Privacidade (BR-MKT-67/75): a família nunca vê a autoria; o profissional nunca recebe `familyId`, `memberId` nem `userId`.
import { canOpen, deriveShareStatus, type RecordShareDerivedStatus, type ShareBookingStatus } from "../domain/index.js";
import type { RecordShareRecord, ShareViewRecord } from "./ports.js";

export interface FamilyShareView {
  id: string;
  bookingId: string;
  professional: { id: string; displayName: string; city: string | null };
  categories: string[];
  validity: string;
  viewOnce: boolean;
  status: RecordShareDerivedStatus;
  expiresAt: string;
  revokedAt: string | null;
  consumedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
}

export function toFamilyShareView(record: RecordShareRecord, professional: { displayName: string; city: string | null } | undefined, now: Date): FamilyShareView {
  return {
    id: record.id,
    bookingId: record.bookingId,
    professional: { id: record.professionalId, displayName: professional?.displayName ?? "", city: professional?.city ?? null },
    categories: [...record.categories],
    validity: record.validity,
    viewOnce: record.viewOnce,
    status: deriveShareStatus(record.status, record.expiresAt, now),
    expiresAt: record.expiresAt.toISOString(),
    revokedAt: record.revokedAt?.toISOString() ?? null,
    consumedAt: record.consumedAt?.toISOString() ?? null,
    viewCount: record.viewCount,
    lastViewedAt: record.lastViewedAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
  };
}

export interface FamilyShareViewEntry {
  viewNo: number;
  viewedAt: string;
  professionalName: string;
  categories: string[];
}

export function toViewEntry(view: ShareViewRecord, professionalName: string): FamilyShareViewEntry {
  return { viewNo: view.viewNo, viewedAt: view.viewedAt.toISOString(), professionalName, categories: [...view.categories] };
}

export interface ProfessionalShareView {
  id: string;
  bookingId: string;
  participantLabel: string;
  categories: string[];
  validity: string;
  viewOnce: boolean;
  status: RecordShareDerivedStatus;
  expiresAt: string;
  openCount: number;
  lastOpenedAt: string | null;
  canOpen: boolean;
  createdAt: string;
}

/** `bookingStatus`/`memberActive`/`approved` lidos agora; `canOpen` é informativo (a abertura reavalia tudo). */
export function toProfessionalShareView(
  record: RecordShareRecord,
  facts: { approved: boolean; bookingStatus: ShareBookingStatus | null; memberActive: boolean },
  now: Date,
): ProfessionalShareView {
  return {
    id: record.id,
    bookingId: record.bookingId,
    participantLabel: record.participantLabel,
    categories: [...record.categories],
    validity: record.validity,
    viewOnce: record.viewOnce,
    status: deriveShareStatus(record.status, record.expiresAt, now),
    expiresAt: record.expiresAt.toISOString(),
    openCount: record.viewCount,
    lastOpenedAt: record.lastViewedAt?.toISOString() ?? null,
    canOpen:
      facts.bookingStatus !== null &&
      canOpen({
        status: record.status,
        expiresAt: record.expiresAt,
        professionalApproved: facts.approved,
        bookingStatus: facts.bookingStatus,
        memberActive: facts.memberActive,
        categories: record.categories,
        professionalCategory: record.professionalCategory,
        now,
      }),
    createdAt: record.createdAt.toISOString(),
  };
}
