// Portas de `reports` (conventions.md §3.2): cada fonte é uma leitura pública do módulo dono,
// ligada no composition root (`main/api.ts`). Já passam pela `AccessPolicy` e pela auditoria do
// módulo dono; sem permissão lançam `ForbiddenError`/`NotFoundError` (secção omitida, BR-RPT-01).
import type { Clock } from "../../../platform/clock/index.js";
import type { MemberPageRead, MemberRead, ReadActor, ReadContext } from "../../../platform/reads/index.js";

export type { ReadActor as ActorIdentity, ReadContext as RequestContext };

export type ApiObject = Record<string, unknown>;

export interface ReportSources {
  /** Membros ativos da família visíveis ao utilizador (`NotFoundError` se não pertencer). */
  listMembers: (userId: string, familyId: string) => Promise<ApiObject[]>;
  bloodType: MemberRead<string>;
  allergies: MemberRead<ApiObject[]>;
  conditions: MemberRead<ApiObject[]>;
  prescriptions: MemberPageRead;
  plans: MemberPageRead;
  doses: MemberPageRead;
  adherence: (actor: ReadActor, familyId: string, memberId: string, query: Record<string, string>, context: ReadContext) => Promise<ApiObject[]>;
  appointments: MemberPageRead;
  examinations: MemberPageRead;
}

export interface ReportsDeps {
  sources: ReportSources;
  clock: Clock;
}
