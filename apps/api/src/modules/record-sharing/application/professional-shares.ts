// Casos de uso do lado do PROFISSIONAL (UC-MKT-53..55; BR-MKT-68, 70..73, 75, 77). A partilha procura-se SEMPRE por (`professionalId` do
// token, id): de outro ou inexistente ⇒ `NOT_FOUND` idêntico. Ler (lista/detalhe) só devolve metadados; ABRIR reavalia tudo a cada pedido.
//
// Abertura (segurança e concorrência):
//  1. limites de taxa fechados (30/min por conta; 120/dia por conta+partilha) ANTES de qualquer leitura;
//  2. numa só transação: `SELECT … FOR UPDATE` da partilha (serializa aberturas e revogações), reavaliação (`evaluateOpen`: estado, prazo,
//     profissional `APPROVED` lido agora, marcação, membro, categorias), leitura do conteúdo concedido e UM `UPDATE` condicional que
//     incrementa `view_count` e, em visualização única, consome (`CONSUMED`), mais a vista imutável e a auditoria `SUCCESS`;
//  3. falha em qualquer passo ⇒ rollback: nada se consome, nenhuma vista, nenhuma auditoria de sucesso;
//  4. recusa ⇒ nada gravado na transação; a auditoria `DENIED` escreve-se em transação própria (audit.md regra 3) e responde-se
//     `403 SHARE_NOT_AVAILABLE` (detail genérico e igual para todas as causas) ou `403 SHARE_ALREADY_VIEWED`.
// O conteúdo, o rótulo e a idade NUNCA vão para auditoria, logs nem erros; a resposta leva `no-store` (router).
import { DomainError, NotFoundError } from "../../../platform/errors/index.js";
import { auditContextFields } from "../../audit/index.js";
import { evaluateOpen, luandaDay, type ShareBookingStatus, type ShareOpenFacts } from "../domain/index.js";
import { decodeShareCursor, encodeShareCursor } from "./cursor.js";
import { parseStatusFilter, type Page } from "./family-shares.js";
import type { ProfessionalActor, RecordShareRecord, RecordSharingDeps, RequestContext } from "./ports.js";
import { enforceShareRate } from "./rate-limit.js";
import type { SharedRecordsContent } from "./shared-records.js";
import { toProfessionalShareView, type ProfessionalShareView } from "./views.js";

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

/** Motivos da recusa auditada (audit.md §3); nunca devolvidos ao cliente. */
export type OpenDenialReason = "EXPIRED" | "REVOKED" | "CONSUMED" | "PROFESSIONAL_NOT_APPROVED" | "BOOKING_INACTIVE" | "MEMBER_BLOCKED";

export interface SharedRecordsViewDto extends SharedRecordsContent {
  shareId: string;
  participantLabel: string;
  openedAt: string;
  expiresAt: string;
  viewOnce: boolean;
  watermark: { professionalName: string; openedOn: string };
}

const SHARE_NOT_AVAILABLE_DETAIL = "Esta partilha já não está disponível.";
const SHARE_ALREADY_VIEWED_DETAIL = "Esta partilha já foi vista.";

export function createProfessionalShares<Trx>(deps: RecordSharingDeps<Trx>) {
  const now = (): Date => deps.clock.now();

  /** Factos lidos agora para um conjunto de partilhas (uma leitura por marcação/membro, sem N+1 repetido). */
  /**
   * A identidade (estado `APPROVED`) lê-se por outra ligação do pool, por isso SEMPRE antes de abrir a transação (com a ligação presa a
   * `FOR UPDATE`, aberturas concorrentes esgotariam o pool: impasse). Sem cache; a janela até ao commit é de milissegundos.
   */
  async function readIdentity(professionalId: string) {
    const [identity] = await deps.professionals.findIdentities([professionalId]);
    return { approved: identity?.approved ?? false, displayName: identity?.displayName ?? "" };
  }

  async function readFacts(trx: Trx, professionalId: string, records: RecordShareRecord[], identity: { approved: boolean; displayName: string }) {
    const bookingStatus = new Map<string, ShareBookingStatus | null>();
    const memberActive = new Map<string, boolean>();
    for (const r of records) {
      if (!bookingStatus.has(r.bookingId)) bookingStatus.set(r.bookingId, (await deps.anchor.getAnchorStatus(trx, r.bookingId, professionalId))?.status ?? null);
      if (!memberActive.has(r.memberId)) memberActive.set(r.memberId, await deps.members.isActive(trx, r.familyId, r.memberId));
    }
    return { approved: identity.approved, bookingStatus, memberActive, displayName: identity.displayName };
  }

  function denialReason(f: ShareOpenFacts): OpenDenialReason {
    if (f.status === "CONSUMED") return "CONSUMED";
    if (f.status === "REVOKED") return "REVOKED";
    if (f.expiresAt.getTime() <= f.now.getTime()) return "EXPIRED";
    if (!f.professionalApproved) return "PROFESSIONAL_NOT_APPROVED";
    if (!f.memberActive) return "MEMBER_BLOCKED";
    // Resta a marcação inativa (e, por invariante da BD, nunca categorias não permitidas).
    return "BOOKING_INACTIVE";
  }

  return {
    /** UC-MKT-53: partilhas recebidas (só metadados), mais recentes primeiro; não auditado. */
    async listShares(actor: ProfessionalActor, query: { bookingId?: string; status?: string; limit?: number; cursor?: string }): Promise<Page<ProfessionalShareView>> {
      const limit = query.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new DomainError("MALFORMED_REQUEST", { detail: "Limite inválido." });
      const status = parseStatusFilter(query.status);
      const after = query.cursor === undefined ? undefined : decodeShareCursor(query.cursor);
      await enforceShareRate(deps.rateLimiter, "professional-read", actor.professionalAccountId);
      const identity = await readIdentity(actor.professionalId);
      return deps.withTransaction(async (trx) => {
        const at = now();
        const rows = await deps.shares.listForProfessional(trx, actor.professionalId, {
          limit: limit + 1,
          now: at,
          ...(query.bookingId ? { bookingId: query.bookingId } : {}),
          ...(status ? { status } : {}),
          ...(after ? { after } : {}),
        });
        const page = rows.slice(0, limit);
        const facts = await readFacts(trx, actor.professionalId, page, identity);
        const last = page.at(-1);
        return {
          items: page.map((r) => toProfessionalShareView(r, { approved: facts.approved, bookingStatus: facts.bookingStatus.get(r.bookingId) ?? null, memberActive: facts.memberActive.get(r.memberId) ?? false }, at)),
          nextCursor: rows.length > limit && last ? encodeShareCursor(last.createdAt, last.id) : null,
        };
      });
    },

    /** UC-MKT-53: metadados de uma partilha; não auditado. */
    async getShare(actor: ProfessionalActor, shareId: string): Promise<ProfessionalShareView> {
      await enforceShareRate(deps.rateLimiter, "professional-read", actor.professionalAccountId);
      const identity = await readIdentity(actor.professionalId);
      return deps.withTransaction(async (trx) => {
        const record = await deps.shares.findForProfessional(trx, actor.professionalId, shareId, false);
        if (!record) throw new NotFoundError({ detail: "Partilha não encontrada." });
        const facts = await readFacts(trx, actor.professionalId, [record], identity);
        return toProfessionalShareView(record, { approved: facts.approved, bookingStatus: facts.bookingStatus.get(record.bookingId) ?? null, memberActive: facts.memberActive.get(record.memberId) ?? false }, now());
      });
    },

    /** UC-MKT-54/55: abre a partilha (ver cabeçalho). */
    async openShare(actor: ProfessionalActor, shareId: string, context: RequestContext): Promise<SharedRecordsViewDto> {
      await enforceShareRate(deps.rateLimiter, "open-minute", actor.professionalAccountId);
      // O sujeito é só `[A-Za-z0-9-]` (dois UUID): sem PII e aceite pela chave do limitador.
      await enforceShareRate(deps.rateLimiter, "open-share-day", `${actor.professionalAccountId}-${shareId}`);

      const identity = await readIdentity(actor.professionalId);
      type Outcome =
        | { kind: "OPEN"; view: SharedRecordsViewDto }
        | { kind: "DENIED"; decision: "NOT_AVAILABLE" | "ALREADY_VIEWED"; reason: OpenDenialReason; familyId: string; memberId: string; at: Date };

      const outcome = await deps.withTransaction<Outcome>(async (trx) => {
        // (1) pertença: de outro profissional ou inexistente ⇒ 404 idêntico. Bloqueia a linha (serializa aberturas e revogações).
        const share = await deps.shares.findForProfessional(trx, actor.professionalId, shareId, true);
        if (!share) throw new NotFoundError({ detail: "Partilha não encontrada." });
        const at = now();
        // (2..5) reavaliação com os factos lidos AGORA (sem cache).
        const facts = await readFacts(trx, actor.professionalId, [share], identity);
        const bookingStatus = facts.bookingStatus.get(share.bookingId) ?? null;
        const openFacts: ShareOpenFacts = {
          status: share.status,
          expiresAt: share.expiresAt,
          professionalApproved: facts.approved,
          // Marcação inexistente/de outro profissional conta como inativa.
          bookingStatus: bookingStatus ?? "CANCELLED",
          memberActive: facts.memberActive.get(share.memberId) ?? false,
          categories: share.categories,
          professionalCategory: share.professionalCategory,
          now: at,
        };
        const decision = evaluateOpen(openFacts);
        if (decision !== "OPEN") return { kind: "DENIED", decision, reason: denialReason(openFacts), familyId: share.familyId, memberId: share.memberId, at };

        // Leitura NO momento, só das categorias concedidas; qualquer falha reverte a transação (nada se consome).
        const content = await deps.reader.read(trx, { familyId: share.familyId, memberId: share.memberId, categories: share.categories, now: at });
        // UM `UPDATE` condicional + vista imutável (BR-MKT-71/73). `null` = a linha já não estava aberta (não deve acontecer sob `FOR UPDATE`).
        const viewNo = await deps.shares.commitOpen(trx, share.id, { at, categories: share.categories });
        if (viewNo === null) return { kind: "DENIED", decision: share.viewOnce ? "ALREADY_VIEWED" : "NOT_AVAILABLE", reason: share.viewOnce ? "CONSUMED" : "EXPIRED", familyId: share.familyId, memberId: share.memberId, at };
        await deps.audit.record(trx, {
          occurredAt: at,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_SHARE_OPEN",
          resourceType: "RecordShare",
          resourceId: share.id,
          familyId: share.familyId,
          subjectMemberId: share.memberId,
          result: "SUCCESS",
          requestId: context.requestId,
          // Só contagens e modo: nunca conteúdo, categorias lidas, rótulo nem idade (BR-MKT-75).
          metadata: { viewNo, viewOnce: share.viewOnce, categoryCount: share.categories.length },
          ...auditContextFields(context),
        });
        return {
          kind: "OPEN",
          view: {
            ...content,
            shareId: share.id,
            participantLabel: share.participantLabel,
            openedAt: at.toISOString(),
            expiresAt: share.expiresAt.toISOString(),
            viewOnce: share.viewOnce,
            watermark: { professionalName: facts.displayName, openedOn: luandaDay(at.getTime()) },
          },
        };
      });

      if (outcome.kind === "OPEN") return outcome.view;
      // Recusa: auditoria `DENIED` em transação própria (a transação da leitura nada gravou).
      await deps.withTransaction((trx) =>
        deps.audit.record(trx, {
          occurredAt: outcome.at,
          actorType: "PROFESSIONAL_ACCOUNT",
          actorProfessionalAccountId: actor.professionalAccountId,
          action: "PROFESSIONAL_SHARE_OPEN",
          resourceType: "RecordShare",
          resourceId: shareId,
          familyId: outcome.familyId,
          subjectMemberId: outcome.memberId,
          result: "DENIED",
          requestId: context.requestId,
          metadata: { reason: outcome.reason },
          ...auditContextFields(context),
        }),
      );
      if (outcome.decision === "ALREADY_VIEWED") throw new DomainError("SHARE_ALREADY_VIEWED", { detail: SHARE_ALREADY_VIEWED_DETAIL });
      throw new DomainError("SHARE_NOT_AVAILABLE", { detail: SHARE_NOT_AVAILABLE_DETAIL });
    },
  };
}

export type ProfessionalShares = ReturnType<typeof createProfessionalShares<unknown>>;
