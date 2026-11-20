// Utilitários partilhados pelos testes de QA/segurança de MK4 (S10): inventário de operações (com os códigos de resposta declarados) lido do
// `openapi.yaml`, chamador por `operationId` e semente de partilhas por SQL. Só leitura do contrato; sem lógica de negócio.
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { Pool } from "pg";
import request from "supertest";
import type { Method } from "./mk3-ops.js";
import { API } from "./professionals-harness.js";

export interface Mk4Op {
  id: string;
  method: Method;
  path: string;
  /** Códigos de resposta declarados no contrato para esta operação. */
  codes: string[];
}

/** TODAS as operações de `paths` (também as de MK4), com os códigos declarados (caminhos a 2 espaços, métodos a 4, operationId a 6, códigos a 8). */
export function parseOpsWithCodes(text: string): Mk4Op[] {
  const ops: Mk4Op[] = [];
  let inPaths = false;
  let path: string | null = null;
  let method: Method | null = null;
  let current: Mk4Op | null = null;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      inPaths = line === "paths:";
      path = null;
      current = null;
      continue;
    }
    if (!inPaths) continue;
    const p = /^ {2}(\/\S*):\s*$/.exec(line);
    if (p) {
      path = p[1] ?? null;
      method = null;
      current = null;
      continue;
    }
    const m = /^ {4}(get|post|put|patch|delete):\s*$/.exec(line);
    if (m) {
      method = m[1] as Method;
      current = null;
      continue;
    }
    const id = /^ {6}operationId: (\w+)/.exec(line);
    if (id && path !== null && method !== null) {
      current = { id: id[1] ?? "", method, path, codes: [] };
      ops.push(current);
      continue;
    }
    const code = /^ {8}'(\d{3})':/.exec(line);
    if (code && current) current.codes.push(code[1] ?? "");
  }
  return ops;
}

/** Rota de MK4 pelo caminho, independentemente da lista de ids (para a conferir). */
export const isMk4Path = (path: string): boolean =>
  path.startsWith("/families/{familyId}/members/{memberId}/record-shares") ||
  path.startsWith("/professional-portal/shares") ||
  /^\/professional-portal\/bookings\/\{bookingId\}\/prescriptions?$/.test(path);

export interface CallOptions {
  params?: Record<string, string>;
  query?: Record<string, string>;
  token?: string | undefined;
  body?: unknown;
}

const authOf = (token?: string): Record<string, string> => (token === undefined ? {} : { Authorization: `Bearer ${token}` });

/** Chamador por `operationId`: os parâmetros de caminho em falta ficam com um UUID novo (inexistente). `observe` regista (operação, estado). */
export function makeCaller(app: Express, ops: Map<string, Mk4Op>, observe?: (opId: string, status: number) => void) {
  return async function call(opId: string, o: CallOptions = {}): Promise<request.Response> {
    const op = ops.get(opId);
    if (!op) throw new Error(`operação desconhecida: ${opId}`);
    const url = `${API}${op.path.replace(/\{(\w+)\}/g, (_m, k: string) => o.params?.[k] ?? randomUUID())}`;
    let req = request(app)[op.method](url).set(authOf(o.token));
    if (o.query) req = req.query(o.query);
    if (o.body !== undefined) req = req.send(o.body as object);
    const res = await req;
    observe?.(opId, res.status);
    return res;
  };
}

/** Campos de transporte (pedido/instância) variam por pedido; o resto tem de ser idêntico para não haver enumeração. */
export const stripTransport = (body: unknown): unknown => ({ ...(body as object), requestId: 0, instance: 0 });

export interface SeedShare {
  familyId: string;
  memberId: string;
  professionalId: string;
  bookingId: string;
  label?: string;
  professionalCategory?: "HEALTH" | "WELLNESS";
  categories?: string[];
  validity?: "H24" | "D7" | "D30" | "UNTIL_CONSULTATION_END_PLUS_24H";
  viewOnce?: boolean;
  createdAt: Date;
  status?: "ACTIVE" | "REVOKED" | "CONSUMED";
  createdByUserId?: string | null;
}

/** Partilha inserida por SQL (respeita as CHECK da migração 0046). */
export async function seedShareRow(pool: Pool, p: SeedShare): Promise<string> {
  const id = randomUUID();
  const status = p.status ?? "ACTIVE";
  await pool.query(
    `INSERT INTO record_shares (id, family_id, member_id, professional_id, booking_id, participant_label, professional_category, categories, validity,
       view_once, expires_at, status, revoked_at, consumed_at, view_count, last_viewed_at, created_by_user_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::specialty_category,$8::data_category[],$9::share_validity,$10,$11,$12::record_share_status,$13,$14,$15,$16,$17,$18,$18)`,
    [
      id,
      p.familyId,
      p.memberId,
      p.professionalId,
      p.bookingId,
      p.label ?? "Semente",
      p.professionalCategory ?? "HEALTH",
      p.categories ?? ["MEDICATION"],
      p.validity ?? "D7",
      p.viewOnce ?? false,
      new Date(p.createdAt.getTime() + 7 * 86_400_000),
      status,
      status === "REVOKED" ? p.createdAt : null,
      status === "CONSUMED" ? p.createdAt : null,
      status === "CONSUMED" ? 1 : 0,
      status === "CONSUMED" ? p.createdAt : null,
      p.createdByUserId ?? null,
      p.createdAt,
    ],
  );
  return id;
}
