// Fakes em memória das portas de `recommendations` (mesmo padrão de `examinations/application/fixtures.ts`).
// Não é ficheiro de teste.
import { decodeCursor, encodeCursor } from "../../../platform/page/index.js";
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput, Relation } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Recommendation } from "../domain/recommendation.js";
import type {
  AccessPolicyPort,
  AuditPort,
  CursorPage,
  MemberRecommendationFilter,
  MemberNamesPort,
  NewRecommendationRecord,
  OriginFacts,
  OriginFilter,
  OriginsPort,
  RecommendationAlertsPort,
  RecommendationsDeps,
  RecommendationsRepository,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

/** Política falsa: nega as categorias em `deniedCategories` (ForbiddenError) e devolve a relação configurada. */
export class FakeAccessPolicy implements AccessPolicyPort<FakeTrx> {
  readonly calls: CanInput[] = [];
  relation: Relation = "SELF";
  readonly deniedCategories = new Set<string>();
  denyWith?: Error;
  forbidden?: () => Error;

  async can(_trx: FakeTrx, input: CanInput): Promise<AccessContext> {
    this.calls.push(input);
    if (this.denyWith) throw this.denyWith;
    if (input.category && this.deniedCategories.has(input.category)) throw (this.forbidden ?? (() => new Error("forbidden")))();
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

export class FakeMemberNamesPort implements MemberNamesPort<FakeTrx> {
  readonly names = new Map<string, string>();
  async getMemberName(_trx: FakeTrx, familyId: string, memberId: string): Promise<string | null> {
    return Promise.resolve(this.names.get(`${familyId}:${memberId}`) ?? null);
  }
}

/** Origens por clínica: `findXOfClinic` só devolve a origem se pertencer à clínica pedida (isolamento). */
export class FakeOriginsPort implements OriginsPort<FakeTrx> {
  private readonly appointments = new Map<string, OriginFacts & { clinicId: string }>();
  private readonly examinations = new Map<string, OriginFacts & { clinicId: string }>();

  seedAppointment(id: string, clinicId: string, facts: OriginFacts): void {
    this.appointments.set(id, { ...facts, clinicId });
  }
  seedExamination(id: string, clinicId: string, facts: OriginFacts): void {
    this.examinations.set(id, { ...facts, clinicId });
  }
  async findAppointmentOfClinic(_trx: FakeTrx, clinicId: string, appointmentId: string): Promise<OriginFacts | null> {
    const origin = this.appointments.get(appointmentId);
    return Promise.resolve(origin?.clinicId === clinicId ? origin : null);
  }
  async findExaminationOfClinic(_trx: FakeTrx, clinicId: string, examinationId: string): Promise<OriginFacts | null> {
    const origin = this.examinations.get(examinationId);
    return Promise.resolve(origin?.clinicId === clinicId ? origin : null);
  }
}

export class FakeRecommendationAlertsPort implements RecommendationAlertsPort<FakeTrx> {
  readonly events: { recommendationId: string; familyId: string; memberId: string }[] = [];
  async raiseRecommendationAdded(_trx: FakeTrx, input: { recommendationId: string; familyId: string; memberId: string }): Promise<number> {
    this.events.push(input);
    return Promise.resolve(1);
  }
}

export class FakeRecommendationsRepository implements RecommendationsRepository<FakeTrx> {
  readonly byId = new Map<string, Recommendation>();

  async insert(_trx: FakeTrx, record: NewRecommendationRecord): Promise<Recommendation> {
    const recommendation: Recommendation = {
      id: record.id,
      familyId: record.familyId,
      memberId: record.memberId,
      clinicId: record.clinicId,
      clinicName: record.clinicName,
      clinicAccountId: record.clinicAccountId,
      text: record.text,
      createdAt: record.createdAt,
      ...(record.appointmentId ? { appointmentId: record.appointmentId } : {}),
      ...(record.examinationId ? { examinationId: record.examinationId } : {}),
    };
    this.byId.set(record.id, recommendation);
    return Promise.resolve(recommendation);
  }

  private sorted(items: Recommendation[]): Recommendation[] {
    return [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  }

  async listByClinic(_trx: FakeTrx, clinicId: string, filter: OriginFilter, limit: number): Promise<Recommendation[]> {
    return Promise.resolve(
      this.sorted([...this.byId.values()].filter((r) => r.clinicId === clinicId && (!filter.appointmentId || r.appointmentId === filter.appointmentId) && (!filter.examinationId || r.examinationId === filter.examinationId))).slice(0, limit),
    );
  }

  async listByClinicAndMember(_trx: FakeTrx, clinicId: string, familyId: string, memberId: string, limit: number): Promise<Recommendation[]> {
    return Promise.resolve(this.sorted([...this.byId.values()].filter((r) => r.clinicId === clinicId && r.familyId === familyId && r.memberId === memberId)).slice(0, limit));
  }

  async listByMember(_trx: FakeTrx, familyId: string, memberId: string, filter: MemberRecommendationFilter, limit: number, cursor?: string): Promise<CursorPage<Recommendation>> {
    const items = this.sorted(
      [...this.byId.values()].filter(
        (r) =>
          r.familyId === familyId &&
          r.memberId === memberId &&
          ((r.appointmentId !== undefined && filter.categories.includes("APPOINTMENTS")) || (r.examinationId !== undefined && filter.categories.includes("EXAMS"))) &&
          (!filter.appointmentId || r.appointmentId === filter.appointmentId) &&
          (!filter.examinationId || r.examinationId === filter.examinationId),
      ),
    );
    let start = 0;
    if (cursor) {
      const decoded = decodeCursor(cursor);
      start = items.findIndex((r) => r.createdAt.toISOString() === decoded.createdAt && r.id === decoded.id) + 1;
    }
    const page = items.slice(start, start + limit);
    const last = page.at(-1);
    const nextCursor = start + limit < items.length && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null;
    return Promise.resolve({ items: page, nextCursor });
  }
}

export interface RecommendationsFixtures {
  deps: RecommendationsDeps<FakeTrx>;
  repo: FakeRecommendationsRepository;
  policy: FakeAccessPolicy;
  audit: FakeAuditPort;
  memberNames: FakeMemberNamesPort;
  origins: FakeOriginsPort;
  alerts: FakeRecommendationAlertsPort;
}

export function createRecommendationsFixtures(clock: Clock): RecommendationsFixtures {
  const repo = new FakeRecommendationsRepository();
  const policy = new FakeAccessPolicy();
  const audit = new FakeAuditPort();
  const memberNames = new FakeMemberNamesPort();
  const origins = new FakeOriginsPort();
  const alerts = new FakeRecommendationAlertsPort();
  return {
    repo,
    policy,
    audit,
    memberNames,
    origins,
    alerts,
    deps: {
      recommendationsRepo: repo,
      policy,
      memberNames,
      origins,
      alerts,
      audit,
      withTransaction: (fn) => fn(FAKE_TRX),
      clock,
    },
  };
}
