// Casos de uso do lado da FAMÍLIA (UC-MKT-48..52; BR-MKT-67..69, 73, 74, 77). Todos começam por `ShareAccess.assertCanShare` (ação
// `SHARE_WITH_PROFESSIONALS`: só `SELF`/`TUTOR_OF`) e procuram a partilha por (família, membro, id): qualquer outra ⇒ `NOT_FOUND`.
// Concorrência: a criação serializa-se por bloqueio consultivo do membro e do utilizador (20 ativas por membro e 20 criações/dia sem
// corridas; a BD é a rede: CHECK, UNIQUE de `clientRequestId`); a revogação bloqueia a linha (a abertura do profissional bloqueia-a também,
// logo revogar e abrir serializam-se: a abertura seguinte vê `REVOKED`).
// Privacidade (BR-MKT-75): erros e auditoria nunca levam rótulo, categorias nem conteúdo; a autoria nunca sai.
import { ConflictError, DomainError, NotFoundError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import { auditContextFields } from "../../audit/index.js";
import {
  ALLOWED_CATEGORIES,
  SHARE_LIMITS,
  SHARE_VALIDITIES,
  bookingAllowsSharing,
  candidateExpiresAtMs,
  canRevoke,
  computeExpiresAtMs,
  isValidityEligible,
  validateCategories,
  type DataCategory,
  type ShareValidity,
} from "../domain/index.js";
import { decodeShareCursor, decodeViewCursor, encodeShareCursor, encodeViewCursor } from "./cursor.js";
import type { ActorIdentity, DerivedStatusFilter, ShareAnchorFacts, RecordShareRecord, RecordSharingDeps, RequestContext } from "./ports.js";
import { enforceShareRate } from "./rate-limit.js";
import { toFamilyShareView, toViewEntry, type FamilyShareView, type FamilyShareViewEntry } from "./views.js";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CreateShareInput {
  bookingId: string;
  categories: string[];
  validity: string;
  viewOnce?: boolean;
  clientRequestId?: string;
}

export interface ShareOptionsView {
  bookingId: string;
  professional: { id: string; displayName: string; city: string | null };
  professionalCategory: "HEALTH" | "WELLNESS";
  allowedCategories: readonly DataCategory[];
  validities: { validity: ShareValidity; expiresAt: string; eligible: boolean }[];
  viewOnceAllowed: boolean;
  maxActive: number;
  activeCount: number;
}

const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const STATUS_FILTERS: readonly DerivedStatusFilter[] = ["ACTIVE", "EXPIRED", "REVOKED", "CONSUMED"];

const invalid = (field: string, message: string): ValidationError => new ValidationError([{ field, message }], { detail: "Dados inválidos." });

function checkLimit(limit: number | undefined): number {
  const value = limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) throw new DomainError("MALFORMED_REQUEST", { detail: "Limite inválido." });
  return value;
}

export function parseStatusFilter(status: string | undefined): DerivedStatusFilter | undefined {
  if (status === undefined) return undefined;
  if (!(STATUS_FILTERS as readonly string[]).includes(status)) throw new DomainError("MALFORMED_REQUEST", { detail: "Estado inválido." });
  return status as DerivedStatusFilter;
}

export function createFamilyShares<Trx>(deps: RecordSharingDeps<Trx>) {
  const now = (): Date => deps.clock.now();

  async function authorize(trx: Trx, actor: ActorIdentity, familyId: string, memberId: string): Promise<void> {
    await deps.access.assertCanShare(trx, { userId: actor.userId, platformAdmin: actor.platformAdmin, familyId, memberId });
  }

  /** Marcação-âncora do membro com a categoria; a categoria lê-se FORA de qualquer transação (ver `ShareAnchor.categoryOf`). */
  async function loadAnchor(actor: ActorIdentity, familyId: string, memberId: string, bookingId: string): Promise<ShareAnchorFacts | null> {
    const base = await deps.withTransaction(async (trx) => {
      await authorize(trx, actor, familyId, memberId);
      return deps.anchor.getAnchorBase(trx, familyId, memberId, bookingId);
    });
    if (!base) return null;
    const professionalCategory = await deps.anchor.categoryOf(base.specialtyId);
    if (!professionalCategory) return null;
    return {
      professionalId: base.professionalId,
      status: base.status,
      startsAt: base.startsAt,
      endsAt: base.endsAt,
      participantLabel: base.participantLabel,
      professionalCategory,
    };
  }

  async function present(records: RecordShareRecord[]): Promise<FamilyShareView[]> {
    if (records.length === 0) return [];
    const at = now();
    const identities = await deps.professionals.findIdentities([...new Set(records.map((r) => r.professionalId))]);
    return records.map((r) => toFamilyShareView(r, identities.find((i) => i.id === r.professionalId), at));
  }

  async function presentOne(record: RecordShareRecord): Promise<FamilyShareView> {
    const [view] = await present([record]);
    if (!view) throw new NotFoundError({ detail: "Partilha não encontrada." });
    return view;
  }

  return {
    /** UC-MKT-48: opções calculadas no servidor; não grava nem audita. */
    async getOptions(actor: ActorIdentity, familyId: string, memberId: string, bookingId: string): Promise<ShareOptionsView> {
      await enforceShareRate(deps.rateLimiter, "family-read", actor.userId);
      const facts = await loadAnchor(actor, familyId, memberId, bookingId);
      if (!facts) throw new NotFoundError({ detail: "Marcação não encontrada." });
      if (!bookingAllowsSharing(facts.status)) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A marcação não permite partilhar." });
      const result = await deps.withTransaction(async (trx) => {
        const at = now();
        return { facts, activeCount: await deps.shares.countActive(trx, memberId, at), at };
      });
      const [identity] = await deps.professionals.findIdentities([result.facts.professionalId]);
      return {
        bookingId,
        professional: { id: result.facts.professionalId, displayName: identity?.displayName ?? "", city: identity?.city ?? null },
        professionalCategory: result.facts.professionalCategory,
        allowedCategories: ALLOWED_CATEGORIES[result.facts.professionalCategory],
        validities: SHARE_VALIDITIES.map((validity) => ({
          validity,
          expiresAt: new Date(candidateExpiresAtMs(validity, result.at, result.facts.endsAt)).toISOString(),
          eligible: isValidityEligible(validity, result.at, result.facts.endsAt),
        })),
        viewOnceAllowed: true,
        maxActive: SHARE_LIMITS.maxActivePerMember,
        activeCount: result.activeCount,
      };
    },

    /** UC-MKT-49: cria numa só transação (ver cabeçalho). `created=false` se `clientRequestId` repetido. */
    async createShare(actor: ActorIdentity, familyId: string, memberId: string, input: CreateShareInput, context: RequestContext): Promise<{ created: boolean; share: FamilyShareView }> {
      // Os factos da marcação leem-se ANTES, fora da transação de criação: a categoria vem do catálogo por outra ligação do pool e, com a
      // ligação da criação presa a um bloqueio consultivo, N criações concorrentes esgotariam o pool (impasse). Rótulo, categoria, fim e
      // profissional são imutáveis; o ESTADO relê-se dentro da transação, sob bloqueio.
      const preFacts = await loadAnchor(actor, familyId, memberId, input.bookingId);
      const result = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        // Sob bloqueio do membro e do utilizador: 20 ativas e 20 criações/dia sem corridas (um tutor com vários membros partilha o limite diário).
        await deps.shares.acquireLocks(trx, [`share-create:${memberId}`, `share-create-user:${actor.userId}`]);
        if (input.clientRequestId) {
          const replay = await deps.shares.findByClientRequestId(trx, memberId, input.clientRequestId);
          if (replay) {
            // Replay só com o mesmo pedido: `bookingId` divergente ⇒ 409 (o resto não se compara, BR-MKT-69).
            if (replay.bookingId !== input.bookingId) throw new ConflictError({ detail: "O identificador do pedido já foi usado com outros dados." });
            return { created: false, record: replay };
          }
        }
        if (!preFacts) throw new NotFoundError({ detail: "Marcação não encontrada." });
        const current = await deps.anchor.getAnchorStatus(trx, input.bookingId, preFacts.professionalId);
        if (!current) throw new NotFoundError({ detail: "Marcação não encontrada." });
        const facts = { ...preFacts, status: current.status };
        if (!bookingAllowsSharing(facts.status)) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A marcação não permite partilhar." });
        if (!(SHARE_VALIDITIES as readonly string[]).includes(input.validity)) throw invalid("validity", "prazo inválido");
        const failure = validateCategories(facts.professionalCategory, input.categories);
        if (failure !== null) throw invalid("categories", "categorias inválidas ou não permitidas");

        const at = now();
        let expiresAtMs: number;
        try {
          expiresAtMs = computeExpiresAtMs(input.validity as ShareValidity, at, facts.endsAt);
        } catch {
          throw invalid("validity", "o prazo já terminou");
        }
        if ((await deps.shares.countActive(trx, memberId, at)) >= SHARE_LIMITS.maxActivePerMember) {
          throw new DomainError("LIMIT_EXCEEDED", { detail: `Máximo de ${String(SHARE_LIMITS.maxActivePerMember)} partilhas ativas por membro.` });
        }
        const recent = (await deps.shares.createTimesByUser(trx, actor.userId, new Date(at.getTime() - DAY_MS))).map((d) => d.getTime()).sort((a, b) => a - b);
        if (recent.length >= SHARE_LIMITS.maxCreatesPerDay) {
          throw new RateLimitedError(Math.max(1, (recent[recent.length - SHARE_LIMITS.maxCreatesPerDay] ?? at.getTime()) + DAY_MS - at.getTime()));
        }

        const record: RecordShareRecord = {
          id: newId(),
          familyId,
          memberId,
          professionalId: facts.professionalId,
          bookingId: input.bookingId,
          participantLabel: facts.participantLabel,
          professionalCategory: facts.professionalCategory,
          categories: input.categories as DataCategory[],
          validity: input.validity as ShareValidity,
          viewOnce: input.viewOnce ?? false,
          expiresAt: new Date(expiresAtMs),
          status: "ACTIVE",
          revokedAt: null,
          consumedAt: null,
          viewCount: 0,
          lastViewedAt: null,
          createdByUserId: actor.userId,
          clientRequestId: input.clientRequestId ?? null,
          createdAt: at,
        };
        await deps.shares.insert(trx, record);
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "RECORD_SHARE_CREATE",
          resourceType: "RecordShare",
          resourceId: record.id,
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          // Sem `participantLabel` e sem a lista de categorias (audit.md §3): só a contagem.
          metadata: { professionalId: record.professionalId, bookingId: record.bookingId, categoryCount: record.categories.length, validity: record.validity, viewOnce: record.viewOnce },
          ...auditContextFields(context),
        });
        return { created: true, record };
      });
      if (result.created) {
        // Depois do commit, melhor esforço (BR-MKT-78): falhar a fila nunca desfaz a partilha nem a revela.
        await deps.notices.enqueueNewShare({ professionalId: result.record.professionalId, shareId: result.record.id }).catch(() => undefined);
      }
      return { created: result.created, share: await presentOne(result.record) };
    },

    /** UC-MKT-50: partilhas do membro, mais recentes primeiro; não auditado. */
    async listShares(actor: ActorIdentity, familyId: string, memberId: string, query: { bookingId?: string; status?: string; limit?: number; cursor?: string }): Promise<Page<FamilyShareView>> {
      const limit = checkLimit(query.limit);
      const status = parseStatusFilter(query.status);
      const after = query.cursor === undefined ? undefined : decodeShareCursor(query.cursor);
      await enforceShareRate(deps.rateLimiter, "family-read", actor.userId);
      const rows = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        return deps.shares.list(trx, familyId, memberId, {
          limit: limit + 1,
          now: now(),
          ...(query.bookingId ? { bookingId: query.bookingId } : {}),
          ...(status ? { status } : {}),
          ...(after ? { after } : {}),
        });
      });
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return { items: await present(page), nextCursor: rows.length > limit && last ? encodeShareCursor(last.createdAt, last.id) : null };
    },

    /** UC-MKT-50: detalhe; não auditado. */
    async getShare(actor: ActorIdentity, familyId: string, memberId: string, shareId: string): Promise<FamilyShareView> {
      await enforceShareRate(deps.rateLimiter, "family-read", actor.userId);
      const record = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const found = await deps.shares.findForMember(trx, familyId, memberId, shareId, false);
        if (!found) throw new NotFoundError({ detail: "Partilha não encontrada." });
        return found;
      });
      return presentOne(record);
    },

    /** UC-MKT-51: quem viu o quê e quando (só aberturas bem-sucedidas); não auditado. */
    async listViews(actor: ActorIdentity, familyId: string, memberId: string, shareId: string, query: { limit?: number; cursor?: string }): Promise<Page<FamilyShareViewEntry>> {
      const limit = checkLimit(query.limit);
      const before = query.cursor === undefined ? undefined : decodeViewCursor(query.cursor);
      await enforceShareRate(deps.rateLimiter, "family-read", actor.userId);
      const { share, rows } = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const found = await deps.shares.findForMember(trx, familyId, memberId, shareId, false);
        if (!found) throw new NotFoundError({ detail: "Partilha não encontrada." });
        return { share: found, rows: await deps.shares.listViews(trx, shareId, limit + 1, before) };
      });
      const [identity] = await deps.professionals.findIdentities([share.professionalId]);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return { items: page.map((v) => toViewEntry(v, identity?.displayName ?? "")), nextCursor: rows.length > limit && last ? encodeViewCursor(last.viewNo) : null };
    },

    /** UC-MKT-52: `ACTIVE` → `REVOKED` com efeito imediato; qualquer dos tutores revoga. */
    async revokeShare(actor: ActorIdentity, familyId: string, memberId: string, shareId: string, context: RequestContext): Promise<FamilyShareView> {
      const record = await deps.withTransaction(async (trx) => {
        await authorize(trx, actor, familyId, memberId);
        const current = await deps.shares.findForMember(trx, familyId, memberId, shareId, true);
        if (!current) throw new NotFoundError({ detail: "Partilha não encontrada." });
        const at = now();
        if (!canRevoke(current.status, current.expiresAt, at)) throw new DomainError("INVALID_STATE_TRANSITION", { detail: "A partilha já não pode ser revogada." });
        await deps.shares.markRevoked(trx, current.id, { at, byUserId: actor.userId });
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "USER",
          actorUserId: actor.userId,
          action: "RECORD_SHARE_REVOKE",
          resourceType: "RecordShare",
          resourceId: current.id,
          familyId,
          subjectMemberId: memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          metadata: { fromStatus: current.status },
          ...auditContextFields(context),
        });
        const updated = await deps.shares.findForMember(trx, familyId, memberId, shareId, false);
        if (!updated) throw new NotFoundError({ detail: "Partilha não encontrada." });
        return updated;
      });
      return presentOne(record);
    },
  };
}

export type FamilyShares = ReturnType<typeof createFamilyShares<unknown>>;
