// Fakes em memória das portas de `processes` (mesmo padrão de `recommendations/application/fixtures.ts`).
// Não é ficheiro de teste.
import { ForbiddenError } from "../../../platform/errors/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput, Relation } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import { kindOfOrigin, type ActFact, type CoverageFact, type Process, type ProcessOriginType } from "../domain/process.js";
import type {
  AccessPolicyPort,
  ActFactEntry,
  ActFactRef,
  AuditPort,
  CoverageFactEntry,
  NewProcessRecord,
  ProcessFacts,
  ProcessListFilter,
  ProcessesDeps,
  ProcessesRepository,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

/** Política falsa: nega as categorias em `deniedCategories` (ForbiddenError) e devolve a relação configurada. */
export class FakeAccessPolicy implements AccessPolicyPort<FakeTrx> {
  readonly calls: CanInput[] = [];
  relation: Relation = "SELF";
  readonly deniedCategories = new Set<string>();
  /** Ações sem categoria (`MANAGE_INSURANCE`, origem `AUTHORIZATION`) negadas. */
  readonly deniedActions = new Set<string>();
  denyWith?: Error;

  async can(_trx: FakeTrx, input: CanInput): Promise<AccessContext> {
    this.calls.push(input);
    if (this.denyWith) throw this.denyWith;
    if (input.platformAdmin || (input.category && this.deniedCategories.has(input.category)) || this.deniedActions.has(input.action)) throw new ForbiddenError({ detail: "negado" });
    return Promise.resolve({
      actor: { id: "actor-1", familyId: input.familyId, name: "Actor", isDependent: false, status: "ACTIVE" },
      subject: { id: input.subjectMemberId ?? "subject-1", familyId: input.familyId, name: "Subject", isDependent: false, status: "ACTIVE" },
      relation: this.relation,
    });
  }
}

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];
  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

/** Factos por `tipo:id`; um ato sem facto semeado conta como "inexistente" (BR-PRC-09). */
export class FakeProcessFacts implements ProcessFacts<FakeTrx> {
  private readonly facts = new Map<string, ActFact>();
  private readonly coverage = new Map<string, CoverageFact>();
  readonly requests: ActFactRef[][] = [];
  readonly coverageRequests: string[][] = [];

  /** Facto de cobertura de um processo (fatia 3). */
  seedCoverage(processId: string, fact: Omit<CoverageFact, "changedAt" | "appeal" | "partial"> & { changedAt?: Date; appeal?: boolean; partial?: boolean }): void {
    this.coverage.set(processId, { changedAt: new Date("2026-01-01T00:00:00Z"), appeal: false, partial: false, ...fact });
  }

  async getCoverageFacts(_trx: FakeTrx, _familyId: string, processIds: string[]): Promise<CoverageFactEntry[]> {
    this.coverageRequests.push(processIds);
    return Promise.resolve(processIds.flatMap((processId) => {
      const fact = this.coverage.get(processId);
      return fact ? [{ processId, fact }] : [];
    }));
  }

  seed(originType: Exclude<ProcessOriginType, "AUTHORIZATION">, originId: string, fact: Omit<ActFact, "source" | "changedAt"> & { changedAt?: Date }): void {
    this.facts.set(`${originType}:${originId}`, { source: originType, changedAt: new Date("2026-01-01T00:00:00Z"), ...fact });
  }

  async getActFacts(_trx: FakeTrx, _familyId: string, refs: ActFactRef[]): Promise<ActFactEntry[]> {
    this.requests.push(refs);
    return Promise.resolve(
      refs.flatMap((ref) => {
        const fact = this.facts.get(`${ref.originType}:${ref.originId}`);
        return fact ? [{ ...ref, fact }] : [];
      }),
    );
  }
}

export class FakeProcessesRepository implements ProcessesRepository<FakeTrx> {
  readonly rows: Process[] = [];

  async insertIfAbsent(_trx: FakeTrx, record: NewProcessRecord): Promise<{ process: Process; created: boolean }> {
    const existing = this.rows.find((p) => p.originType === record.originType && p.originId === record.originId);
    if (existing) return Promise.resolve({ process: existing, created: false });
    const process: Process = {
      id: record.id,
      familyId: record.familyId,
      memberId: record.memberId,
      kind: record.kind,
      originType: record.originType,
      originId: record.originId,
      openedAt: record.openedAt,
      ...(record.clinicId ? { clinicId: record.clinicId } : {}),
    };
    this.rows.push(process);
    return Promise.resolve({ process, created: true });
  }

  async deleteByOrigin(_trx: FakeTrx, originType: ProcessOriginType, originId: string): Promise<Process | null> {
    const index = this.rows.findIndex((p) => p.originType === originType && p.originId === originId);
    const [removed] = index >= 0 ? this.rows.splice(index, 1) : [];
    return Promise.resolve(removed ?? null);
  }

  async findOfMember(_trx: FakeTrx, familyId: string, memberId: string, processId: string): Promise<Process | null> {
    return Promise.resolve(this.rows.find((p) => p.familyId === familyId && p.memberId === memberId && p.id === processId) ?? null);
  }

  async listOfMember(_trx: FakeTrx, familyId: string, memberId: string, filter: ProcessListFilter, limit: number): Promise<{ rows: Process[]; hasMore: boolean }> {
    const sorted = this.rows
      .filter((p) => p.familyId === familyId && p.memberId === memberId && filter.originTypes.includes(p.originType))
      .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime() || (a.id < b.id ? 1 : -1))
      .filter((p) => {
        if (!filter.after) return true;
        const at = new Date(filter.after.createdAt).getTime();
        return p.openedAt.getTime() < at || (p.openedAt.getTime() === at && p.id < filter.after.id);
      });
    return Promise.resolve({ rows: sorted.slice(0, limit), hasMore: sorted.length > limit });
  }

  async findByIds(_trx: FakeTrx, processIds: string[]): Promise<Process[]> {
    return Promise.resolve(this.rows.filter((p) => processIds.includes(p.id)));
  }

  async findOfClinic(_trx: FakeTrx, clinicId: string, processId: string): Promise<Process | null> {
    return Promise.resolve(this.rows.find((p) => p.clinicId === clinicId && p.id === processId) ?? null);
  }
}

export interface ProcessesFixtures {
  deps: ProcessesDeps<FakeTrx>;
  repo: FakeProcessesRepository;
  facts: FakeProcessFacts;
  policy: FakeAccessPolicy;
  audit: FakeAuditPort;
  inconsistencies: { processId: string; originType: ProcessOriginType }[];
  /** Semeia um processo + o facto do ato; devolve o processo. */
  addProcess: (input: { id: string; memberId?: string; familyId?: string; originType?: ProcessOriginType; originId?: string; clinicId?: string; openedAt: Date; phase?: ActFact["phase"] | null }) => Process;
}

export function createProcessesFixtures(clock: Clock): ProcessesFixtures {
  const repo = new FakeProcessesRepository();
  const facts = new FakeProcessFacts();
  const policy = new FakeAccessPolicy();
  const audit = new FakeAuditPort();
  const inconsistencies: { processId: string; originType: ProcessOriginType }[] = [];
  const deps: ProcessesDeps<FakeTrx> = {
    repo,
    facts,
    policy,
    audit,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
    onInconsistency: (info) => inconsistencies.push(info),
  };
  const addProcess: ProcessesFixtures["addProcess"] = (input) => {
    const originType = input.originType ?? "APPOINTMENT";
    const originId = input.originId ?? `act-${input.id}`;
    const process: Process = {
      id: input.id,
      familyId: input.familyId ?? "family-1",
      memberId: input.memberId ?? "member-1",
      kind: kindOfOrigin(originType),
      originType,
      originId,
      openedAt: input.openedAt,
      ...(input.clinicId ? { clinicId: input.clinicId } : {}),
    };
    repo.rows.push(process);
    // Origem `AUTHORIZATION` não tem ato: o facto de cobertura semeia-se à parte (`facts.seedCoverage`).
    if (input.phase !== null && originType !== "AUTHORIZATION") facts.seed(originType, originId, { phase: input.phase ?? "SCHEDULED" });
    return process;
  };
  return { deps, repo, facts, policy, audit, inconsistencies, addProcess };
}

