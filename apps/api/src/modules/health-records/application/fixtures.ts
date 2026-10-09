// Fakes em memória das portas de `health-records` para testes de casos de uso (mesmo padrão de
// `modules/families/application/fixtures.ts` e `modules/access/application/fixtures.ts`). Não é
// ficheiro de teste.
import type { Clock } from "../../../platform/clock/index.js";
import type { AccessContext, CanInput, Relation } from "../../access/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Allergy } from "../domain/allergy.js";
import type { BloodType } from "../domain/blood-type.js";
import type { MedicalCondition } from "../domain/medical-condition.js";
import type {
  AccessPolicyPort,
  AllergiesRepository,
  AllergyChanges,
  AuditPort,
  ConditionChanges,
  FamiliesPort,
  HealthRecordsDeps,
  MedicalConditionsRepository,
  NewAllergyRecord,
  NewConditionRecord,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

/**
 * Fake de `AccessPolicy.can()` (`access.policy`, modules.md §2): health-records confia na decisão
 * de `access` (já testada em `access/application/policy.test.ts`/`category-matrix.matrix.test.ts`)
 * — aqui só se simula ALLOW (com a `relation` escolhida pelo teste) ou DENY (erro injetado),
 * gravando os pedidos (`calls`) para os testes verificarem a categoria/ação pedidas.
 */
export class FakeAccessPolicy implements AccessPolicyPort<FakeTrx> {
  readonly calls: CanInput[] = [];
  relation: Relation = "SELF";
  denyWith?: Error;

  async can(_trx: FakeTrx, input: CanInput): Promise<AccessContext> {
    this.calls.push(input);
    if (this.denyWith) {
      throw this.denyWith;
    }
    return Promise.resolve({
      actor: { id: "actor-1", familyId: input.familyId, name: "Actor", isDependent: false, status: "ACTIVE" },
      subject: {
        id: input.subjectMemberId ?? "subject-1",
        familyId: input.familyId,
        name: "Subject",
        isDependent: false,
        status: "ACTIVE",
      },
      relation: this.relation,
    });
  }
}

export class FakeAllergiesRepository implements AllergiesRepository<FakeTrx> {
  readonly byId = new Map<string, Allergy>();

  async insert(_trx: FakeTrx, record: NewAllergyRecord): Promise<Allergy> {
    const allergy: Allergy = {
      id: record.id,
      familyId: record.familyId,
      memberId: record.memberId,
      name: record.name,
      createdAt: record.createdAt,
      ...(record.notes !== undefined ? { notes: record.notes } : {}),
      ...(record.since !== undefined ? { since: record.since } : {}),
    };
    this.byId.set(allergy.id, allergy);
    return Promise.resolve(allergy);
  }

  async findById(_trx: FakeTrx, familyId: string, memberId: string, allergyId: string): Promise<Allergy | null> {
    const allergy = this.byId.get(allergyId);
    return Promise.resolve(allergy?.familyId === familyId && allergy.memberId === memberId ? allergy : null);
  }

  async listByMember(_trx: FakeTrx, familyId: string, memberId: string): Promise<Allergy[]> {
    return Promise.resolve([...this.byId.values()].filter((a) => a.familyId === familyId && a.memberId === memberId));
  }

  async update(_trx: FakeTrx, familyId: string, memberId: string, allergyId: string, changes: AllergyChanges): Promise<Allergy> {
    const allergy = this.byId.get(allergyId);
    if (!allergy) {
      throw new Error("alergia inexistente no fake");
    }
    if (allergy.familyId !== familyId || allergy.memberId !== memberId) {
      throw new Error("alergia inexistente no fake");
    }
    const updated: Allergy = { ...allergy };
    if (changes.name !== undefined) updated.name = changes.name;
    if (changes.notes === null) delete updated.notes;
    else if (changes.notes !== undefined) updated.notes = changes.notes;
    if (changes.since === null) delete updated.since;
    else if (changes.since !== undefined) updated.since = changes.since;
    this.byId.set(allergyId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, familyId: string, memberId: string, allergyId: string): Promise<void> {
    const allergy = this.byId.get(allergyId);
    if (allergy?.familyId === familyId && allergy.memberId === memberId) {
      this.byId.delete(allergyId);
    }
    return Promise.resolve();
  }

  seed(allergy: Allergy): void {
    this.byId.set(allergy.id, allergy);
  }
}

export class FakeMedicalConditionsRepository implements MedicalConditionsRepository<FakeTrx> {
  readonly byId = new Map<string, MedicalCondition>();

  async insert(_trx: FakeTrx, record: NewConditionRecord): Promise<MedicalCondition> {
    const condition: MedicalCondition = {
      id: record.id,
      familyId: record.familyId,
      memberId: record.memberId,
      name: record.name,
      kind: record.kind,
      createdAt: record.createdAt,
      ...(record.notes !== undefined ? { notes: record.notes } : {}),
      ...(record.since !== undefined ? { since: record.since } : {}),
      ...(record.until !== undefined ? { until: record.until } : {}),
    };
    this.byId.set(condition.id, condition);
    return Promise.resolve(condition);
  }

  async findById(_trx: FakeTrx, familyId: string, memberId: string, conditionId: string): Promise<MedicalCondition | null> {
    const condition = this.byId.get(conditionId);
    return Promise.resolve(condition?.familyId === familyId && condition.memberId === memberId ? condition : null);
  }

  async listByMember(_trx: FakeTrx, familyId: string, memberId: string): Promise<MedicalCondition[]> {
    return Promise.resolve([...this.byId.values()].filter((c) => c.familyId === familyId && c.memberId === memberId));
  }

  async update(
    _trx: FakeTrx,
    familyId: string,
    memberId: string,
    conditionId: string,
    changes: ConditionChanges,
  ): Promise<MedicalCondition> {
    const condition = this.byId.get(conditionId);
    if (!condition) {
      throw new Error("condição inexistente no fake");
    }
    if (condition.familyId !== familyId || condition.memberId !== memberId) {
      throw new Error("condição inexistente no fake");
    }
    const updated: MedicalCondition = { ...condition };
    if (changes.name !== undefined) updated.name = changes.name;
    if (changes.kind !== undefined) updated.kind = changes.kind;
    if (changes.notes === null) delete updated.notes;
    else if (changes.notes !== undefined) updated.notes = changes.notes;
    if (changes.since === null) delete updated.since;
    else if (changes.since !== undefined) updated.since = changes.since;
    if (changes.until === null) delete updated.until;
    else if (changes.until !== undefined) updated.until = changes.until;
    this.byId.set(conditionId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, familyId: string, memberId: string, conditionId: string): Promise<void> {
    const condition = this.byId.get(conditionId);
    if (condition?.familyId === familyId && condition.memberId === memberId) {
      this.byId.delete(conditionId);
    }
    return Promise.resolve();
  }

  seed(condition: MedicalCondition): void {
    this.byId.set(condition.id, condition);
  }
}

export class FakeFamiliesPort implements FamiliesPort<FakeTrx> {
  readonly bloodTypes = new Map<string, BloodType>();

  async getBloodType(_trx: FakeTrx, _familyId: string, memberId: string): Promise<BloodType | null> {
    return Promise.resolve(this.bloodTypes.get(memberId) ?? null);
  }

  async setBloodType(_trx: FakeTrx, _familyId: string, memberId: string, bloodType: BloodType): Promise<BloodType> {
    this.bloodTypes.set(memberId, bloodType);
    return Promise.resolve(bloodType);
  }

  seed(memberId: string, bloodType: BloodType): void {
    this.bloodTypes.set(memberId, bloodType);
  }
}

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];

  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export interface HealthRecordsFixtures {
  deps: HealthRecordsDeps<FakeTrx>;
  allergiesRepo: FakeAllergiesRepository;
  conditionsRepo: FakeMedicalConditionsRepository;
  familiesPort: FakeFamiliesPort;
  policy: FakeAccessPolicy;
  audit: FakeAuditPort;
}

export function createHealthRecordsFixtures(clock: Clock): HealthRecordsFixtures {
  const allergiesRepo = new FakeAllergiesRepository();
  const conditionsRepo = new FakeMedicalConditionsRepository();
  const familiesPort = new FakeFamiliesPort();
  const policy = new FakeAccessPolicy();
  const audit = new FakeAuditPort();
  const deps: HealthRecordsDeps<FakeTrx> = {
    allergiesRepo,
    conditionsRepo,
    familiesPort,
    policy,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, allergiesRepo, conditionsRepo, familiesPort, policy, audit };
}
