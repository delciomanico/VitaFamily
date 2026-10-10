// Fakes em memória das portas de `clinics` (mesmo padrão de `prescriptions`/`health-records`
// `application/fixtures.ts`). Não é ficheiro de teste.
import type { Clock } from "../../../platform/clock/index.js";
import type { AuditEvent } from "../../audit/index.js";
import type { Clinic, ClinicStatus } from "../domain/clinic.js";
import type {
  AccessPort,
  AuditPort,
  ClinicChanges,
  ClinicListFilter,
  ClinicsDeps,
  ClinicsRepository,
  MembershipFacts,
  NewClinicRecord,
} from "./ports.js";

export type FakeTrx = Record<string, never>;
const FAKE_TRX: FakeTrx = {};

export class FakeAccessPort implements AccessPort<FakeTrx> {
  readonly membersByFamily = new Map<string, MembershipFacts>();

  async getMembershipFacts(_trx: FakeTrx, familyId: string, userId: string): Promise<MembershipFacts | null> {
    return Promise.resolve(this.membersByFamily.get(`${familyId}|${userId}`) ?? null);
  }

  seed(familyId: string, userId: string, facts: MembershipFacts): void {
    this.membersByFamily.set(`${familyId}|${userId}`, facts);
  }
}

export class FakeAuditPort implements AuditPort<FakeTrx> {
  readonly events: AuditEvent[] = [];

  async record(_trx: FakeTrx, event: AuditEvent): Promise<void> {
    this.events.push(event);
    return Promise.resolve();
  }
}

export class FakeClinicsRepository implements ClinicsRepository<FakeTrx> {
  readonly byId = new Map<string, Clinic>();

  async insert(_trx: FakeTrx, record: NewClinicRecord): Promise<Clinic> {
    const clinic: Clinic = {
      id: record.id,
      type: record.type,
      name: record.name,
      status: "ACTIVE",
      createdAt: record.createdAt,
      ...(record.familyId !== undefined ? { familyId: record.familyId } : {}),
      ...(record.address !== undefined ? { address: record.address } : {}),
      ...(record.phone !== undefined ? { phone: record.phone } : {}),
      ...(record.email !== undefined ? { email: record.email } : {}),
      ...(record.createdBy !== undefined ? { createdBy: record.createdBy } : {}),
    };
    this.byId.set(clinic.id, clinic);
    return Promise.resolve(clinic);
  }

  async findById(_trx: FakeTrx, clinicId: string): Promise<Clinic | null> {
    return Promise.resolve(this.byId.get(clinicId) ?? null);
  }

  async listVisibleToFamily(_trx: FakeTrx, familyId: string, filter: ClinicListFilter): Promise<Clinic[]> {
    return Promise.resolve(
      [...this.byId.values()].filter(
        (clinic) => (clinic.type === "PARTNER" || clinic.familyId === familyId) && (!filter.status || clinic.status === filter.status),
      ),
    );
  }

  async listPartners(_trx: FakeTrx, filter: ClinicListFilter): Promise<Clinic[]> {
    return Promise.resolve([...this.byId.values()].filter((clinic) => clinic.type === "PARTNER" && (!filter.status || clinic.status === filter.status)));
  }

  async countPrivateByFamily(_trx: FakeTrx, familyId: string): Promise<number> {
    return Promise.resolve([...this.byId.values()].filter((clinic) => clinic.type === "PRIVATE" && clinic.familyId === familyId).length);
  }

  async update(_trx: FakeTrx, clinicId: string, changes: ClinicChanges): Promise<Clinic> {
    const clinic = this.requireClinic(clinicId);
    const updated: Clinic = { ...clinic };
    if (changes.name !== undefined) updated.name = changes.name;
    if (changes.address === null) delete updated.address;
    else if (changes.address !== undefined) updated.address = changes.address;
    if (changes.phone === null) delete updated.phone;
    else if (changes.phone !== undefined) updated.phone = changes.phone;
    if (changes.email === null) delete updated.email;
    else if (changes.email !== undefined) updated.email = changes.email;
    this.byId.set(clinicId, updated);
    return Promise.resolve(updated);
  }

  async updateStatus(_trx: FakeTrx, clinicId: string, status: ClinicStatus): Promise<Clinic> {
    const clinic = this.requireClinic(clinicId);
    const updated: Clinic = { ...clinic, status };
    this.byId.set(clinicId, updated);
    return Promise.resolve(updated);
  }

  async delete(_trx: FakeTrx, clinicId: string): Promise<void> {
    this.byId.delete(clinicId);
    return Promise.resolve();
  }

  private requireClinic(clinicId: string): Clinic {
    const clinic = this.byId.get(clinicId);
    if (!clinic) {
      throw new Error("clínica inexistente no fake");
    }
    return clinic;
  }

  seed(clinic: Clinic): void {
    this.byId.set(clinic.id, clinic);
  }
}

export interface ClinicsFixtures {
  deps: ClinicsDeps<FakeTrx>;
  clinicsRepo: FakeClinicsRepository;
  access: FakeAccessPort;
  audit: FakeAuditPort;
}

export function createClinicsFixtures(clock: Clock): ClinicsFixtures {
  const clinicsRepo = new FakeClinicsRepository();
  const access = new FakeAccessPort();
  const audit = new FakeAuditPort();
  const deps: ClinicsDeps<FakeTrx> = {
    clinicsRepo,
    access,
    audit,
    db: FAKE_TRX,
    withTransaction: (fn) => fn(FAKE_TRX),
    clock,
  };
  return { deps, clinicsRepo, access, audit };
}
