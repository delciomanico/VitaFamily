// `GET /clinic-portal/audit` (UC-CLN-31, BR-CLN-40): vista de gestão da própria organização sobre os atos dos seus
// funcionários. Exceção estreita a P7 (audit.md §2 regra 4, ratificada em OP-42): só `CLINIC_ADMIN`, só entradas de
// contas do portal da clínica do token, só id/ação/recurso/resultado/conta (sem PII, sem `metadata`). A leitura não se audita.
import { ForbiddenError, RateLimitedError, ValidationError } from "../../../platform/errors/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import { decodeCursor, encodeCursor, parsePageParams } from "../../../platform/page/index.js";
import type { RateLimiter } from "../../../platform/rate-limit/index.js";
import type { ClinicAuditEntry, ClinicAuditReader } from "./ports.js";

export interface ClinicAuditActor {
  clinicAccountId: string;
  clinicId: string;
  role: string;
}

export interface ListClinicAuditQuery {
  from?: string;
  to?: string;
  action?: string;
  actorAccountId?: string;
  limit?: string;
  cursor?: string;
}

export interface ClinicAuditPageView {
  items: ClinicAuditEntry[];
  nextCursor: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const AUDIT_MAX_WINDOW_MS = 366 * DAY_MS;
/** Retenção de 24 meses (audit.md regra 6). */
export const AUDIT_RETENTION_MONTHS = 24;
export const CLINIC_AUDIT_RATE = { max: 30, windowMs: 60_000 };
const MAX_ACTION_LENGTH = 64;

interface Deps<Trx> {
  reader: ClinicAuditReader<Trx>;
  withTransaction: <T>(fn: (trx: Trx) => Promise<T>) => Promise<T>;
  limiter: RateLimiter;
  clock: Clock;
}

function parseInstant(raw: string | undefined, field: string): Date | undefined {
  if (raw === undefined) return undefined;
  const value = new Date(raw);
  if (Number.isNaN(value.getTime())) {
    throw new ValidationError([{ field, message: "instante inválido" }], { detail: "Período inválido." });
  }
  return value;
}

/** Janela efetiva `[from, to]`: omissões => `to` = agora, `from` = 366 dias antes; ≤ 366 dias e dentro da retenção. */
export function resolveAuditWindow(now: Date, rawFrom: string | undefined, rawTo: string | undefined): { from: Date; to: Date } {
  const to = parseInstant(rawTo, "to") ?? now;
  const retentionStart = new Date(now);
  retentionStart.setUTCMonth(retentionStart.getUTCMonth() - AUDIT_RETENTION_MONTHS);
  const from = parseInstant(rawFrom, "from") ?? new Date(Math.max(to.getTime() - AUDIT_MAX_WINDOW_MS, retentionStart.getTime()));
  if (to.getTime() < from.getTime()) {
    throw new ValidationError([{ field: "to", message: "tem de ser posterior a from" }], { detail: "Período inválido." });
  }
  if (to.getTime() - from.getTime() > AUDIT_MAX_WINDOW_MS) {
    throw new ValidationError([{ field: "to", message: "janela máxima de 366 dias" }], { detail: "Período demasiado longo." });
  }
  if (from.getTime() < retentionStart.getTime()) {
    throw new ValidationError([{ field: "from", message: "fora da retenção de 24 meses" }], { detail: "Período fora da retenção." });
  }
  return { from, to };
}

export function createListClinicAuditUseCase<Trx>(deps: Deps<Trx>) {
  return async function listClinicAudit(actor: ClinicAuditActor, query: ListClinicAuditQuery): Promise<ClinicAuditPageView> {
    if (actor.role !== "CLINIC_ADMIN") {
      throw new ForbiddenError({ detail: "Só o Admin da clínica vê a auditoria." });
    }
    const decision = deps.limiter.consume(`clinic-audit:${actor.clinicAccountId}`, CLINIC_AUDIT_RATE);
    if (!decision.allowed) {
      throw new RateLimitedError(decision.retryAfterMs);
    }
    const { limit, cursor } = parsePageParams(query.limit, query.cursor);
    const { from, to } = resolveAuditWindow(deps.clock.now(), query.from, query.to);
    if (query.action !== undefined && (query.action.length === 0 || query.action.length > MAX_ACTION_LENGTH)) {
      throw new ValidationError([{ field: "action", message: "1 a 64 caracteres" }], { detail: "Filtro inválido." });
    }
    const decoded = cursor ? decodeCursor(cursor) : undefined;
    if (decoded && (Number.isNaN(new Date(decoded.createdAt).getTime()) || !/^\d+$/.test(decoded.id))) {
      throw new ValidationError([{ field: "cursor", message: "inválido" }], { detail: "Cursor de paginação inválido." });
    }
    const after = decoded;
    const entries = await deps.withTransaction((trx) =>
      deps.reader.list(
        trx,
        {
          clinicId: actor.clinicId,
          from,
          to,
          ...(query.action !== undefined ? { action: query.action } : {}),
          ...(query.actorAccountId !== undefined ? { actorAccountId: query.actorAccountId } : {}),
          ...(after ? { after: { occurredAt: new Date(after.createdAt), id: after.id } } : {}),
        },
        limit + 1,
      ),
    );
    const items = entries.slice(0, limit);
    const last = items[items.length - 1];
    const nextCursor = entries.length > limit && last ? encodeCursor({ createdAt: last.occurredAt.toISOString(), id: last.id }) : null;
    return { items, nextCursor };
  };
}
