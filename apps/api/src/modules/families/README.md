# Módulo `families`

M2 (`plan.md` §4): `Family`, `FamilyMember`, `Guardianship`, `Invitation` e as suas invariantes — família, membros, dependentes, tutela, convites, limites, papéis (FR-FAM, FR-MEM, BR-FAM/BR-MEM, exceto ciclo de vida, que é M9).

**Não inclui** `AccessPolicy` nem a matriz de autorização por categoria de dados de saúde (`SharingGrant`) — isso é o módulo `access`, M3. Este módulo só faz as verificações **estruturais locais** (quem pode gerir a família/membros/tutores/convites: `FAM_ADMIN`, titular, tutor — `authorization.md` §4), em `application/membership.ts`, e nunca expõe dados de saúde (por isso a restrição P5 "dependente com conta só vê nomes" já está automaticamente satisfeita: o `Member` da API nunca tem campos de saúde). Estas verificações são invariantes da própria entidade `FamilyMember`/`Guardianship` e **ficam aqui** — `access` depende de `families` (`modules.md` §2) e nunca o inverso, pelo que não há (nem pode haver) substituição destes pontos por `AccessPolicy.can()`; esta expõe, isso sim, operações cruas (`findMemberByUserId`, `findMemberById`, `isGuardianOf`) para `access` resolver a matriz de categorias de dados de saúde (`authorization.md` §3) nos módulos de saúde (M4+).

## Mapa de um pedido típico
```
POST /families
  → interface/router.ts                    # rota autenticada (actor por auth/M1)
    → application/create-family.ts         # caso de uso: limite de 5 famílias (BR-FAM-07/B4),
      → application/ports.ts               #   cria Family + FamilyMember(FAMILY_ADMIN) na mesma tx
        → infrastructure/repo.ts           # KyselyFamiliesRepository/KyselyMembersRepository
          → audit.record(trx, …)           # módulo audit, mesma transação (FAMILY_CREATE)
```

```
POST /families/{familyId}/members
  → interface/router.ts
    → application/create-member.ts         # FAM_ADMIN (membership.ts); valida menor⇒dependente
      → application/guardian-rules.ts      #   e tutor(es) válido(s) (BR-MEM-03..08)
        → infrastructure/repo.ts           # INSERT family_members + guardianships
```

```
POST /invitations/accept
  → interface/router.ts                    # AUTH (qualquer utilizador autenticado)
    → application/accept-invitation.ts     # token opaco (domain/token.ts) -> convite PENDING
      → application/membership.ts          #   e-mail/data de nascimento coincidem (BR-MEM-17)
        → infrastructure/repo.ts           # liga FamilyMember existente OU cria um novo
```

## Camadas presentes
- `domain/` — `Family`, `FamilyMember`, `Guardianship`, `Invitation` (tipos + regras puras: idade, validade do convite, transições de estado do convite); `token.ts`/`rate-limiter.ts` são cópias pequenas e intencionais de `auth/domain` (módulos só se importam pela raiz — mesmo critério documentado em `auth/domain/registration-rules.ts`).
- `application/` — um ficheiro por caso de uso (24: família ×6, membro ×7, tutores ×4, convites ×6, exportação ×1) + `ports.ts` (repositórios genéricos em `Trx`, `Mailer`, `UsersPort`) + `membership.ts`/`guardian-rules.ts` (helpers partilhados, fazem I/O por isso não são `domain`) + `family-view.ts`/`member-view.ts`/`invitation-view.ts` (DTOs internos) + `fixtures.ts` (fakes para testes).
- `infrastructure/` — `KyselyFamiliesRepository`, `KyselyMembersRepository`, `KyselyGuardianshipsRepository`, `KyselyInvitationsRepository` (implementam as portas); `schema.ts` (tabelas Kysely); `mailer-smtp.ts` (e-mail de convite — cópia pequena de `auth/infrastructure/mailer-smtp.ts`, `families` não pode depender de `auth`, `modules.md` §2).
- `interface/router.ts`, `interface/dto.ts` — rotas `/families*` e `/invitations/*`.

## Porquê cada porta existe (ADR-016)
- `FamiliesRepository`/`MembersRepository`/`GuardianshipsRepository`/`InvitationsRepository`: Postgres via Kysely, substituíveis/testáveis com fake (critério 1 e 3).
- `Mailer`: e-mail de convite, sem esperar pelo módulo `notifications` (M8) — 2.º consumidor real (SMTP) e necessidade de fake em testes (critério 1 e 3), mesmo critério de `auth`.
- `UsersPort`: só o subconjunto de `users` que `families` consome pela raiz (`byId`, `byEmail`) — `modules.md` §2 declara esta dependência.
- Não há `AccessPolicy` aqui de propósito: ver nota no topo. `application/membership.ts` (`requireMembership`, `requireAdmin`, `assertCanActOnMember`, `assertCanManageGuardians`) implementa invariantes estruturais próprias desta entidade e não é substituído por `access` (ciclo impossível, `modules.md` §2); o que `access`/M3 consome deste módulo são as operações cruas `findMemberByUserId`/`findMemberById`/`isGuardianOf`, ligadas em `index.ts` (mesmo critério de `UsersModule.byId`/`byEmail`).

## Dependências em falta (fora do âmbito de M2)
- `dataChoice=TAKE` em `leave-family.ts`, `removeMember` de um membro **com conta** (BR-MEM-16) e `requestDependentExport` dependem da geração do pacote de exportação (`DataExport`), que é do módulo `lifecycle` (M9, ainda não implementado). Ficam como stubs explícitos (`SERVICE_UNAVAILABLE`), igual ao critério já usado em `modules/users/application/delete-me.ts` — as validações de negócio (LAST_ADMIN, LAST_GUARDIAN, tutela, pertença) já estão implementadas e não precisam de refazer-se quando M9 vier substituir só a geração do ficheiro.
- `POST /auth/register` com `invitationToken` (convite `DEPENDENT_ACCOUNT`) continua a devolver `INVITATION_INVALID` (stub de M1, `modules/auth/application/register.ts`) — ligar este fluxo ao `invitationsRepo` deste módulo não fazia parte do âmbito combinado com o proprietário para esta tarefa; fica assinalado para quando essa integração for pedida.

## Migração
`db/migrations/0003_families.sql`: `families`, `family_members`, `guardianships`, `invitations`. Isolamento entre famílias (ADR-008/AC-ISO-01) por FK composta `(family_id, member_id) -> family_members(family_id, id)` em `guardianships`/`invitations`. Tutor principal único por dependente (BR-MEM-06) garantido na BD por índice único parcial `guardianships_primary_guardian_idx (dependent_id) WHERE is_primary`.
