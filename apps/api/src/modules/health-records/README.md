# Módulo `health-records`

M4 (`plan.md` §4): `Allergy`, `MedicalCondition`, tipo sanguíneo (FR-HP). O módulo mais pequeno de registos de saúde — sem catálogos (D8), sem versionamento (R6: só estado atual, a auditoria é o histórico de quem alterou).

**Toda a autorização passa por `access.policy.can()`** (ADR-008, `authorization.md` §3) — este módulo nunca decide sozinho quem pode ler/escrever; só traduz as rotas em `{action, category}` e chama a política antes de tocar em qualquer repositório. `Allergy`/tipo sanguíneo usam a categoria `ALLERGIES`; `MedicalCondition` usa `CONDITIONS` (`entities.md`).

## Mapa de um pedido típico
```
POST /families/{familyId}/members/{memberId}/allergies
  → interface/router.ts                    # rota autenticada (actor por auth/M1)
    → application/create-allergy.ts        # valida nome (domain/allergy.ts)
      → access/index.js (policy.can)       #   CREATE/ALLERGIES -> ALLOW ou lança Forbidden/NotFound
        → infrastructure/repo.ts           # KyselyAllergiesRepository.insert (tx)
          → audit.record(trx, …)           # módulo audit, mesma transação (ALLERGY_CREATE)
```

```
GET /families/{familyId}/members/{memberId}/allergies
  → interface/router.ts
    → application/list-allergies.ts        # READ/ALLERGIES -> policy devolve a relação (SELF/TUTOR_OF/OTHER)
      → infrastructure/repo.ts             # listByMember
        → application/support.ts           # audita HEALTH_VIEW só se relation != SELF (audit.md §3)
```

```
PUT /families/{familyId}/members/{memberId}/blood-type
  → interface/router.ts
    → application/put-blood-type.ts        # UPDATE/ALLERGIES (mesma matriz do Allergy)
      → families/index.js (setBloodType)   #   blood_type vive em family_members (modules.md §3 nota 9)
        → audit.record(trx, …)             # BLOODTYPE_UPDATE
```

## Camadas presentes
- `domain/` — `Allergy`/`assertValidRecordName` (nome obrigatório, sem espaços nas pontas); `MedicalCondition`/`ConditionKind`/`assertValidConditionDates` (schema.md §3: `until >= since`, comparação lexicográfica de datas ISO, pura); `BloodType` (cópia pequena e intencional do tipo de `families/domain/member.ts` — módulos só se importam pela raiz, mesmo critério de `auth/domain/registration-rules.ts`).
- `application/` — um ficheiro por caso de uso (10: alergias ×4, condições ×4, tipo sanguíneo ×2) + `ports.ts` (`AllergiesRepository`/`MedicalConditionsRepository` genéricos em `Trx`, `FamiliesPort` só com `getBloodType`/`setBloodType`, `AccessPolicyPort` — subconjunto de `AccessPolicy.can()`) + `support.ts` (`auditViewIfNotSelf`, partilhado pelas 3 leituras) + `fixtures.ts` (fakes, incluindo `FakeAccessPolicy` configurável por `relation`/`denyWith` — a decisão de `access` já está testada em `access/application/policy.test.ts`/`category-matrix.matrix.test.ts`, aqui só se verifica que a categoria/ação certas são pedidas e que o DENY é propagado).
- `infrastructure/` — `KyselyAllergiesRepository`, `KyselyMedicalConditionsRepository` (implementam as portas); `schema.ts` (tabelas Kysely `allergies`/`medical_conditions`).
- `interface/router.ts`, `interface/dto.ts` — as 10 rotas de `endpoints.md` ("Health records").

## Porquê cada porta existe (ADR-016)
- `AllergiesRepository`/`MedicalConditionsRepository`: Postgres via Kysely, substituíveis/testáveis com fake (critério 1 e 3) — tabelas próprias de `health-records` (conventions.md §3.5).
- `AccessPolicyPort`: `access.policy` (`AccessModule`, modules.md §2) é a única fonte de autorização — porta local porque `access/index.ts` não exporta o tipo `AccessPolicy` em si (só `AccessModule.policy: AccessPolicy<...>`); reconstruída a partir de `CanInput`/`AccessContext`, que **são** exportados, mantendo a mesma assinatura sem acoplar `health-records` a Kysely.
- `FamiliesPort`: só `getBloodType`/`setBloodType`, o subconjunto de `families` que este módulo consome pela raiz (modules.md §3 nota 9) — nunca o objeto `FamilyMember` completo.

## Decisão de change control: `health-records` passa a depender de `families` (modules.md §3 nota 9)
`modules.md` §2 listava `health-records` como dependendo só de `access, audit`. Ao implementar `getBloodType`/`putBloodType` (`endpoints.md`), descobriu-se que `blood_type` **não é uma tabela de `health-records`** — é uma coluna de `family_members` (`schema.md` §2, `entities.md`: campo de `FamilyMember`). `conventions.md` §3.5 ("só os repositórios de cada módulo acedem às suas tabelas") proíbe `health-records` de tocar nessa tabela diretamente. Decisão (não inventada: aplicação literal de §3.5 + do precedente já registado nas notas 7/8 de `modules.md` §3): acrescentar `families` à lista de dependências de `health-records` e expor duas operações cruas em `FamiliesModule` (`getBloodType`/`setBloodType`, mesmo critério de `findMemberById`/`isGuardianOf` já expostos para `access`). A autorização continua inteiramente em `access.policy.can()` (categoria `ALLERGIES`); `families` só lê/escreve a coluna, sem decidir nada. Atualizado em `modules.md` §2/§3 e `tests/architecture-rules.ts` (`MODULE_DEPENDENCIES`) nesta mesma tarefa — sem ciclo (`families` continua sem importar `health-records`).

## Migração
`db/migrations/0005_health_records.sql`: `allergies`, `medical_conditions`. Isolamento entre famílias (ADR-008/AC-ISO-01) por FK composta `(family_id, member_id) -> family_members(family_id, id)`. `medical_conditions` repete o CHECK `until >= since` de `schema.md` §3 (NULL em qualquer lado não viola o CHECK). Tipo sanguíneo não tem migração própria — já existe em `family_members.blood_type` desde `0003_families.sql`. Índices por `member_id` (`indexes.md`).

## Pendente para revisão do proprietário
Nenhum ponto de comportamento ficou por decidir nesta tarefa (ao contrário do guard global pendente em `access/README.md`) — a única divergência encontrada (dependência de `families`) foi resolvida por aplicação direta das regras já documentadas (`conventions.md` §3.5) e está registada acima.
