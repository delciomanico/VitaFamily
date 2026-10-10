# Módulo `access`

M3 (`plan.md` §4): única fonte de autorização (`AccessPolicy.can()`, `modules.md` §2, ADR-008) e gestão de `SharingGrant` (partilha por categoria, "partilhado comigo"). FR-PRIV, BR-PRV, NFR-SEC-04.

**Não duplica** as invariantes estruturais de `families` (quem é Family Admin, tutor, titular dentro da própria família — `authorization.md` §4, `families/application/membership.ts`): essas ficam em `families` porque `access` depende de `families` (nunca o inverso, `modules.md` §2) — substituí-las criaria um ciclo. `AccessPolicy.can()` decide (a) a matriz de dados de saúde por categoria (`authorization.md` §3, para os módulos de saúde M4+ chamarem) e (b) quem pode gerir a partilha (`MANAGE_SHARING`, `authorization.md` §4). Resolve pertença/tutela consultando as operações cruas expostas por `families/index.ts` (`findMemberByUserId`, `findMemberById`, `isGuardianOf` — mesmo critério de `UsersModule.byId`/`byEmail`).

## Mapa de um pedido típico
```
PUT /families/{familyId}/members/{memberId}/sharing
  → interface/router.ts                    # rota autenticada (actor por auth/M1)
    → application/put-sharing.ts           # policy.can(MANAGE_SHARING) -> SELF ou TUTOR_OF
      → application/policy.ts              #   resolve pertença/relação via familiesPort
        → infrastructure/repo.ts           # KyselySharingGrantsRepository.replaceForOwner (tx)
          → audit.record(trx, …)           # módulo audit, mesma transação (SHARING_UPDATE)
```

```
GET /families/{familyId}/shared-with-me
  → interface/router.ts
    → application/shared-with-me.ts        # policy.can(VIEW_SHARED_WITH_ME) -> só pertença
      → infrastructure/repo.ts             # listForGrantee (grantee = eu OU toda a família)
        → application/ports.ts (familiesPort) # nomes dos titulares
```

```
(M4+) health-records/application/get-allergies.ts
  → modules/access/index.js                # import pela raiz (modules.md §2)
    → access.policy.can(trx, { action: "READ", category: "ALLERGIES", subjectMemberId, … })
      → application/policy.ts              # resolve relação; decide pela matriz (domain/category-matrix.ts)
```

## Camadas presentes
- `domain/` — `SharingGrant`/`DataCategory` (entidade + categorias C2..C6, BR-PRV-10 deixa C1 fora); `Relation` (SELF/TUTOR_OF/DEPENDENT_SELF/OTHER) + `resolveSelfRelation` (puro); `category-matrix.ts` — a matriz de `authorization.md` §3 **como dados** (`RELATION_CATEGORY_RULES`) e `decideCategory`/`isActionAllowed` (leitura/mapeamento, não lógica de negócio nova); `category-matrix.matrix.test.ts` gera os casos a partir de uma tabela transcrita independentemente (conventions.md §4) — deriva da documentação, não da implementação, para detetar desvios.
- `application/` — `ports.ts` (`FamiliesPort`, `SharingGrantsRepository`, `AuditPort`, genéricos em `Trx`); `policy.ts` (`AccessPolicy.can()` — algoritmo de `authorization.md` §2, passos 2/3/5/6/7; o passo 1 já foi resolvido pelo middleware de `auth`, o passo 4 estrutural fica em `families`); `get-sharing.ts`/`put-sharing.ts`/`shared-with-me.ts` (casos de uso); `sharing-view.ts` (DTOs internos); `fixtures.ts` (fakes para testes).
- `infrastructure/` — `KyselySharingGrantsRepository` (implementa a porta); `schema.ts` (tabela Kysely `sharing_grants`).
- `interface/router.ts`, `interface/dto.ts` — rotas `getSharing`/`putSharing`/`sharedWithMe` (tag `Sharing`, `openapi.yaml`).

## Porquê cada porta existe (ADR-016)
- `SharingGrantsRepository`: Postgres via Kysely, substituível/testável com fake (critério 1 e 3) — tabela própria de `access` (conventions.md §3.5).
- `FamiliesPort`: só o subconjunto de `families` que `access` consome pela raiz (`findMemberByUserId`, `findMemberById`, `isGuardianOf`) — `modules.md` §2 declara esta dependência; tipo local `MemberFacts` (não importa `FamilyMember` de `families`) pelo mesmo critério de `UserLookup` em `families/application/ports.ts`.

## Guarda de verificação (authorization.md §5.1, plan.md M3)
`authorization.md` diz "toda a rota de negócio chama `AccessPolicy`"; isso só é válido, em código, para rotas que decidem **dados de saúde por categoria** ou **partilha** — as três rotas deste módulo chamam `policy.can()` diretamente nos seus casos de uso, o que já satisfaz o invariante para elas (sem guard adicional: a dependência está no próprio `createXUseCase`, não há caminho que a evite). As rotas estruturais de `families`/`users`/`auth` **não** usam `AccessPolicy` por desenho (ver nota em `families/index.ts`) — por isso um guard global (ex.: middleware que falha se nenhuma rota de negócio chamou `can()`) ficaria por definir: exigiria um allowlist de rotas isentas que nenhum documento especifica ainda. Decisão: não forçar esse guard global em `main/api.ts` nesta tarefa (risco de quebrar as rotas estruturais existentes sem uma base documental); fica para quando os módulos de saúde (M4+) adotarem `AccessPolicy.can()` e a lista de rotas "sem decisão" ficar conhecida. Assinalado para revisão do proprietário.

## `getMembershipFacts` (M7, change control)
`clinics` depende só de `access` (`modules.md` §2) mas precisa de `role`/`isAdult` do actor para as regras ESTRUTURAIS de "Clínicas privadas" (`authorization.md` §4 — não é decisão de `AccessPolicy.can()`, não há categoria de dados de saúde). Mesmo critério de `getEffectiveTimezone`/`getBloodType`: `access/index.ts` chama `families.findMemberByUserId` e computa `isAdult` com `domain/age.ts` (`isAdultAt`, duplicado do cálculo de `families/domain/member.ts` — `access` não pode importar o `domain` de outro módulo, só a sua raiz). Ver `clinics/README.md` para o detalhe completo desta decisão.

## Migração
`db/migrations/0004_access.sql`: `sharing_grants`. Isolamento entre famílias (ADR-008/AC-ISO-01) por FK composta `(family_id, owner_member_id)` e `(family_id, grantee_member_id)` -> `family_members(family_id, id)`. Unicidade por `(owner_member_id, grantee_member_id, category)` com `NULLS NOT DISTINCT` (BR-PRV-01..04) e índices de leitura (`indexes.md`: `(grantee_member_id, category)`, `(owner_member_id)`). `migrations.md` agrupava conceptualmente "sharing" em "0003"; como `0003_families.sql` já estava fechado (M2), ficou em `0004_access.sql` — próxima migração (M4, registos de saúde) usará `0005`.
