// Raiz do módulo `access` (ADR-015/conventions.md §1): única API pública importável por outros
// módulos (`health-records`, `prescriptions`, `medications`, `appointments`, `examinations`,
// `documents`, `reports` — M4+) e pelo composition root (`main/api.ts`). M3 (plan.md §4): única
// fonte de autorização (`AccessPolicy.can()`, modules.md §2) e gestão de `SharingGrant`
// (partilha por categoria, "partilhado comigo"). Depende só de `families` (API pública,
// `findMemberByUserId`/`findMemberById`/`isGuardianOf`) — nunca o inverso (ver nota em
// `families/index.ts`).
import type { Router } from "express";
import type { Kysely } from "kysely";
import type { Clock } from "../../platform/clock/index.js";
import type { Database } from "../../platform/db/index.js";
import { withTransaction } from "../../platform/db/index.js";
import type { AuditModule } from "../audit/index.js";
import type { FamiliesModule } from "../families/index.js";
import { isAdultAt } from "./domain/age.js";
import { createGetSharingUseCase } from "./application/get-sharing.js";
import type { AccessDeps } from "./application/ports.js";
import { createAccessPolicy, type AccessPolicy } from "./application/policy.js";
import { createPutSharingUseCase } from "./application/put-sharing.js";
import { createSharedWithMeUseCase } from "./application/shared-with-me.js";
import { KyselySharingGrantsRepository } from "./infrastructure/repo.js";
import { createAccessRouter, type AccessController } from "./interface/router.js";

export type { DataCategory, SharingGrant } from "./domain/sharing-grant.js";
export type { Relation } from "./domain/relation.js";
export type { Action, AccessContext, CanInput } from "./application/policy.js";
export type { ActorIdentity } from "./application/get-sharing.js";
export type { SharedWithMeItemView, SharingSettingsView } from "./application/sharing-view.js";

/**
 * Factos estruturais de pertença (modules.md §3 nota 11, M7): `clinics` depende só de `access`
 * (modules.md §2 — não de `families`, para não abrir uma aresta nova no grafo além da já
 * existente `access` → `families`) mas precisa de `role` (FAMILY_ADMIN) e `isAdult` para as
 * regras estruturais de `authorization.md` §4 ("Clínicas privadas: criar — adulto da família;
 * editar/arquivar/eliminar — criador ou FAMILY_ADMIN"), que não são decisões de
 * `AccessPolicy.can()` (não há categoria de dados de saúde envolvida). Mesmo critério de
 * `getEffectiveTimezone`/`getBloodType`: passagem/computação direta pela raiz, sem passar pela
 * política.
 */
export interface MembershipFacts {
  memberId: string;
  role?: "FAMILY_ADMIN" | "FAMILY_MEMBER";
  isAdult: boolean;
  status: "ACTIVE" | "BLOCKED";
}

export interface AccessModuleDeps {
  db: Kysely<Database>;
  audit: AuditModule;
  families: FamiliesModule;
  clock: Clock;
}

export interface AccessModule {
  router: Router;
  /**
   * `AccessPolicy.can()` (modules.md §2) para os módulos de saúde (M4+) chamarem pela raiz —
   * `access` resolve pertença/relação (authorization.md §2) consultando `families` internamente;
   * quem chama só passa identificadores (`userId`, `familyId`, `subjectMemberId`, `category`).
   */
  policy: AccessPolicy<Kysely<Database>>;
  /**
   * Passagem direta para `families.getEffectiveTimezone` (modules.md §2 nota 10, M6): `medications`
   * depende só de `access`/`audit` (modules.md §2) — nunca de `families` diretamente — por isso usa
   * esta função (já disponível porque `access` depende de `families`) para calcular o fuso efetivo
   * do sujeito (Q8/DM6/BR-MED-08) ao gerar/recalcular ocorrências de toma. Não é uma decisão de
   * `AccessPolicy` (não há ação/categoria a autorizar aqui — quem chama já autorizou a operação de
   * negócio antes); por isso não passa por `policy.can()`.
   */
  getEffectiveTimezone: (trx: Kysely<Database>, familyId: string, memberId: string) => Promise<string>;
  /**
   * Factos de pertença do actor (modules.md §3 nota 11, M7) — `clinics` chama isto em vez de
   * `families.findMemberByUserId` diretamente (dependência não declarada). Devolve `null` se o
   * actor não é membro da família (chamador decide NOT_FOUND, mesmo critério de `policy.can()`).
   */
  getMembershipFacts: (trx: Kysely<Database>, familyId: string, userId: string) => Promise<MembershipFacts | null>;
}

/** Composition root chama isto uma vez por processo (main/api.ts). */
export function createAccessModule(deps: AccessModuleDeps): AccessModule {
  const sharingGrantsRepo = new KyselySharingGrantsRepository();

  const accessDeps: AccessDeps<Kysely<Database>> = {
    sharingGrantsRepo,
    // Operações cruas de `families` (mesmo critério de `UsersPort` em `families/application/ports.ts`):
    // `FamilyMember` (families) é um sobreconjunto estrutural de `MemberFacts` (access).
    familiesPort: {
      findMemberByUserId: deps.families.findMemberByUserId,
      findMemberById: deps.families.findMemberById,
      isGuardianOf: deps.families.isGuardianOf,
    },
    audit: deps.audit,
    db: deps.db,
    withTransaction: (fn) => withTransaction(deps.db, fn),
    clock: deps.clock,
  };

  const policy = createAccessPolicy(accessDeps);

  const controller: AccessController = {
    getSharing: createGetSharingUseCase(accessDeps, policy),
    putSharing: createPutSharingUseCase(accessDeps, policy),
    sharedWithMe: createSharedWithMeUseCase(accessDeps, policy),
  };

  return {
    router: createAccessRouter(controller),
    policy,
    getEffectiveTimezone: (trx, familyId, memberId) => deps.families.getEffectiveTimezone(trx, familyId, memberId),
    getMembershipFacts: async (trx, familyId, userId) => {
      const member = await deps.families.findMemberByUserId(trx, familyId, userId);
      if (!member) {
        return null;
      }
      return {
        memberId: member.id,
        ...(member.role ? { role: member.role } : {}),
        isAdult: isAdultAt(member.birthDate, deps.clock.now()),
        status: member.status,
      };
    },
  };
}
