// Portas da `application` de `record-sharing` (ADR-016; modules.md nota 38). O módulo NÃO importa `access`, `families`, `professionals`,
// `consultations`, módulos de saúde, `lifecycle`, `admin`… (só `audit` e `platform`): tudo o que vem de fora entra por estas portas,
// ligadas em `main/api.ts`. Conteúdo partilhado, `participantLabel` e `ageYears` nunca vão para logs nem auditoria (BR-MKT-75).
import type { RateLimiter } from "../../../platform/rate-limit/async.js";
import type { AuditEvent } from "../../audit/index.js";
import type { DataCategory, ProfessionalCategory, RecordShareStatus, ShareBookingStatus, ShareValidity } from "../domain/index.js";
import type { SharedRecordsReader } from "./shared-records.js";

export interface ShareClock {
  now(): Date;
}

export interface ActorIdentity {
  userId: string;
  platformAdmin: boolean;
}

/** Ator do portal do profissional (token de `ProfessionalAccount`); o estado de validação NÃO vem do token (lê-se por pedido). */
export interface ProfessionalActor {
  professionalId: string;
  professionalAccountId: string;
}

export interface RequestContext {
  requestId: string;
  ip?: string;
  userAgent?: string;
}

export type WithTransaction<Trx> = <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;

export interface AuditPort<Trx> {
  record(trx: Trx, event: AuditEvent): Promise<void>;
}

/** Ação `SHARE_WITH_PROFESSIONALS` (só `SELF`/`TUTOR_OF`; `main/api.ts` sobre `access`). Lança `NotFoundError`/`ForbiddenError`/`MEMBER_BLOCKED`. */
export interface ShareAccess<Trx> {
  assertCanShare(trx: Trx, input: { userId: string; platformAdmin: boolean; familyId: string; memberId: string }): Promise<{ relation: "SELF" | "TUTOR_OF" }>;
}

export interface ShareAnchorFacts {
  professionalId: string;
  status: ShareBookingStatus;
  startsAt: Date;
  endsAt: Date;
  participantLabel: string;
  professionalCategory: ProfessionalCategory;
}

export type ShareAnchorBase = Omit<ShareAnchorFacts, "professionalCategory"> & { specialtyId: string };

/** Porta `ShareAnchor` (marcação-âncora; `consultations.shareAnchor` em `main/api.ts`). Só factos, nunca notas nem preços. */
export interface ShareAnchor<Trx> {
  /** Marcação do membro SEM categoria (só `trx`); `null` se inexistente ou de outro membro/família (BR-MKT-67). */
  getAnchorBase(trx: Trx, familyId: string, memberId: string, bookingId: string): Promise<ShareAnchorBase | null>;
  /** Categoria da especialidade (catálogo, ligação própria do pool): chamar SEMPRE fora de uma transação aberta (esgotaria o pool). */
  categoryOf(specialtyId: string): Promise<ProfessionalCategory | null>;
  /** Estado atual para a reavaliação a cada abertura (BR-MKT-70); `null` se a marcação não existe ou não é deste profissional. */
  getAnchorStatus(trx: Trx, bookingId: string, professionalId: string): Promise<{ status: ShareBookingStatus } | null>;
}

export interface ShareProfessionalIdentity {
  id: string;
  displayName: string;
  city: string | null;
  /** `validation_status = APPROVED` lido AGORA, sem cache. */
  approved: boolean;
}

export interface ShareProfessionals {
  findIdentities(ids: readonly string[]): Promise<ShareProfessionalIdentity[]>;
}

/** Estado do membro-sujeito (`families.findMemberById`): `BLOCKED` torna a partilha inaberta (BR-MKT-70). */
export interface ShareMembers<Trx> {
  isActive(trx: Trx, familyId: string, memberId: string): Promise<boolean>;
}

/** Aviso genérico ao profissional (fila, DEPOIS do commit; melhor esforço; `singletonKey` = `shareId`; BR-MKT-78). Sem conteúdo. */
export interface ShareNotices {
  enqueueNewShare(input: { professionalId: string; shareId: string }): Promise<void>;
}

export interface RecordShareRecord {
  id: string;
  familyId: string;
  memberId: string;
  professionalId: string;
  bookingId: string;
  participantLabel: string;
  professionalCategory: ProfessionalCategory;
  categories: DataCategory[];
  validity: ShareValidity;
  viewOnce: boolean;
  expiresAt: Date;
  status: RecordShareStatus;
  revokedAt: Date | null;
  consumedAt: Date | null;
  viewCount: number;
  lastViewedAt: Date | null;
  createdByUserId: string | null;
  clientRequestId: string | null;
  createdAt: Date;
}

export type DerivedStatusFilter = "ACTIVE" | "EXPIRED" | "REVOKED" | "CONSUMED";

export interface ShareListFilter {
  bookingId?: string;
  status?: DerivedStatusFilter;
  /** Instante de referência do estado derivado (`Clock`). */
  now: Date;
  limit: number;
  /** Mantém só as que vêm DEPOIS (ordem `createdAt DESC, id DESC`). */
  after?: { createdAt: Date; id: string };
}

export interface ShareViewRecord {
  viewNo: number;
  viewedAt: Date;
  categories: DataCategory[];
}

export interface RecordShareRepository<Trx> {
  /** Serializa por chave (bloqueio consultivo transacional), adquirido por ordem de chave. */
  acquireLocks(trx: Trx, keys: readonly string[]): Promise<void>;
  /** Procurada SEMPRE por (família, membro, id): outra ⇒ `null`. `forUpdate` bloqueia a linha. */
  findForMember(trx: Trx, familyId: string, memberId: string, shareId: string, forUpdate: boolean): Promise<RecordShareRecord | null>;
  findByClientRequestId(trx: Trx, memberId: string, clientRequestId: string): Promise<RecordShareRecord | null>;
  /** Partilhas `ACTIVE` e não expiradas do membro (limite de 20). */
  countActive(trx: Trx, memberId: string, now: Date): Promise<number>;
  /** Instantes das criações deste utilizador desde `since` (limite diário, sob bloqueio). */
  createTimesByUser(trx: Trx, userId: string, since: Date): Promise<Date[]>;
  list(trx: Trx, familyId: string, memberId: string, filter: ShareListFilter): Promise<RecordShareRecord[]>;
  insert(trx: Trx, record: RecordShareRecord): Promise<void>;
  /** `ACTIVE → REVOKED` (a linha já está bloqueada pelo chamador). */
  markRevoked(trx: Trx, shareId: string, change: { at: Date; byUserId: string }): Promise<void>;
  listViews(trx: Trx, shareId: string, limit: number, beforeViewNo?: number): Promise<ShareViewRecord[]>;

  /** Lado do PROFISSIONAL: procurada SEMPRE por (`professionalId` do token, id); de outro ⇒ `null`. */
  findForProfessional(trx: Trx, professionalId: string, shareId: string, forUpdate: boolean): Promise<RecordShareRecord | null>;
  listForProfessional(trx: Trx, professionalId: string, filter: ShareListFilter): Promise<RecordShareRecord[]>;
  /**
   * Abertura bem-sucedida, num ÚNICO `UPDATE` condicional (`status='ACTIVE' AND expires_at > agora`): `view_count + 1`, `last_viewed_at` e,
   * se `view_once`, `status='CONSUMED'`/`consumed_at` (BR-MKT-71). Devolve o `viewNo` novo ou `null` se a linha já não estava aberta
   * (corrida perdida). Na mesma chamada grava a vista imutável (`record_share_views`, só categorias, nunca conteúdo).
   */
  commitOpen(trx: Trx, shareId: string, input: { at: Date; categories: readonly DataCategory[] }): Promise<number | null>;
}

export interface RecordSharingDeps<Trx> {
  withTransaction: WithTransaction<Trx>;
  clock: ShareClock;
  /** Porta assíncrona (ADR-038), namespace `record-sharing`. */
  rateLimiter: RateLimiter;
  audit: AuditPort<Trx>;
  access: ShareAccess<Trx>;
  anchor: ShareAnchor<Trx>;
  professionals: ShareProfessionals;
  members: ShareMembers<Trx>;
  reader: SharedRecordsReader<Trx>;
  notices: ShareNotices;
  shares: RecordShareRepository<Trx>;
}
