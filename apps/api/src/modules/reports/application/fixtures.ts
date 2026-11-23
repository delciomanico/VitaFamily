// Fakes em memória das portas do Resumo de saúde (M17), para testes de unidade e de rotas. Não é ficheiro de teste.
import { ForbiddenError } from "../../../platform/errors/index.js";
import type { ReadPage } from "../../../platform/reads/index.js";
import type { ApiObject, HealthSummaryDeps } from "./ports.js";

export type Category = "ALLERGIES" | "MEDICATION" | "APPOINTMENTS" | "EXAMS";

export interface MemberData {
  bloodType?: string | null;
  prescriptions?: ApiObject[];
  plans?: ApiObject[];
  doses?: ApiObject[];
  adherence?: ApiObject[];
  appointments?: ApiObject[];
  examinations?: ApiObject[];
  alerts?: { total: number; unread: number; byType: Record<string, number> };
}

export interface SummaryFixtureOptions {
  now: Date;
  members: ApiObject[];
  data: Record<string, MemberData>;
  /** `memberId` -> categorias que o pedinte NÃO pode ler (a leitura lança `ForbiddenError`). */
  denied?: Record<string, Category[]>;
  /** `memberId` -> categorias em que o pedinte pode escrever. */
  writable?: Record<string, Category[]>;
  timezone?: string;
  /** Pedidos permitidos antes de `RATE_LIMITED`. */
  rateLimit?: number;
}

const page = (items: ApiObject[]): ReadPage => ({ items, nextCursor: null });

export function createSummaryFixtures(options: SummaryFixtureOptions) {
  const audit: { memberId: string; kind: string; familyId: string }[] = [];
  const reads: { source: string; memberId: string; query?: Record<string, string> }[] = [];
  let consumed = 0;

  const guard = <T>(source: string, category: Category, memberId: string, value: T, query?: Record<string, string>): T => {
    reads.push({ source, memberId, ...(query ? { query } : {}) });
    if (options.denied?.[memberId]?.includes(category)) throw new ForbiddenError();
    return value;
  };
  const data = (memberId: string): MemberData => options.data[memberId] ?? {};

  const deps: HealthSummaryDeps = {
    clock: { now: () => options.now },
    rateLimiter: {
      consume: () => {
        consumed++;
        const allowed = consumed <= (options.rateLimit ?? 1000);
        return Promise.resolve({ allowed, retryAfterMs: allowed ? 0 : 30_000 });
      },
    },
    sources: {
      listMembers: () => Promise.resolve(options.members),
      bloodType: (_a, _f, m) => Promise.resolve(guard("bloodType", "ALLERGIES", m, data(m).bloodType ?? (null as unknown as string))),
      allergies: (_a, _f, m) => Promise.resolve(guard("allergies", "ALLERGIES", m, [])),
      conditions: (_a, _f, m) => Promise.resolve(guard("conditions", "ALLERGIES", m, [])),
      prescriptions: (_a, _f, m, q) => Promise.resolve(guard("prescriptions", "MEDICATION", m, page(data(m).prescriptions ?? []), q)),
      plans: (_a, _f, m, q) => Promise.resolve(guard("plans", "MEDICATION", m, page((data(m).plans ?? []).filter((p) => !q.status || p.status === q.status)), q)),
      doses: (_a, _f, m, q) =>
        Promise.resolve(
          guard(
            "doses",
            "MEDICATION",
            m,
            page((data(m).doses ?? []).filter((d) => (!q.from || String(d.scheduledAt) >= q.from) && (!q.to || String(d.scheduledAt) <= q.to))),
            q,
          ),
        ),
      adherence: (_a, _f, m, q) => Promise.resolve(guard("adherence", "MEDICATION", m, data(m).adherence ?? [], q)),
      appointments: (_a, _f, m, q) =>
        Promise.resolve(
          guard(
            "appointments",
            "APPOINTMENTS",
            m,
            page((data(m).appointments ?? []).filter((a) => (!q.from || String(a.scheduledAt) >= q.from) && (!q.to || String(a.scheduledAt) <= q.to) && (!q.status || a.status === q.status))),
            q,
          ),
        ),
      examinations: (_a, _f, m, q) => Promise.resolve(guard("examinations", "EXAMS", m, page(data(m).examinations ?? []), q)),
    },
    summary: {
      alerts: (_a, _f, m) => Promise.resolve(data(m).alerts ?? { total: 0, unread: 0, byType: {} }),
      canWrite: (_a, _f, m, category) => Promise.resolve(options.writable?.[m]?.includes(category) ?? false),
      timezone: () => Promise.resolve(options.timezone ?? "Europe/Lisbon"),
      auditView: (_a, familyId, memberId, kind) => {
        audit.push({ familyId, memberId, kind });
        return Promise.resolve();
      },
    },
  };
  return { deps, audit, reads };
}
