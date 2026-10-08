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
  };
}
