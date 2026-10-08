# Módulo `users`

Perfil do utilizador: consulta/edição dos próprios dados, aceitação de termos (B6) e as operações cruas (`createAccount`, `byEmail`, `byId`, `setEmailVerified`, `setPasswordHash`) que o módulo `auth` chama pela raiz para criar/autenticar contas.

## Mapa de um pedido típico
```
GET /users/me
  → interface/router.ts                 # rota autenticada (actor já resolvido por auth/M1)
    → application/get-me.ts             # caso de uso: só lê, sem regra de negócio complexa
      → application/ports.ts            # UsersRepository (o que o caso de uso precisa)
        → infrastructure/repo.ts         # KyselyUsersRepository.findById — SELECT real
```

```
POST /users/me/terms-acceptance
  → interface/router.ts
    → application/accept-terms.ts       # valida versão aceite == TERMS_VERSION atual (B6)
      → infrastructure/repo.ts          # UPDATE users.terms_accepted_version/_at
        → audit.record(trx, …)          # módulo audit, mesma transação
```

```
auth/index.ts (outro módulo, só pela raiz)
  → users.createAccount / byEmail / byId / setEmailVerified / setPasswordHash   # index.ts
    → application/raw-operations.ts     # operações cruas expostas a auth (CLAUDE.md M1 §3)
      → infrastructure/repo.ts
```

## Camadas presentes
- `domain/user.ts` — entidade `User`, estados (`PENDING_VERIFICATION`/`ACTIVE`/`SUSPENDED`), sem I/O.
- `application/` — `get-me`, `update-me`, `accept-terms`, `delete-me` (ainda sem efeito em M1 — por isso não chama `infrastructure`), `raw-operations` (as 5 operações cruas para `auth`), `ports.ts`.
- `infrastructure/repo.ts` — `KyselyUsersRepository`, implementa `UsersRepository`.
- `interface/router.ts`, `interface/dto.ts` — rotas `/users/me*` e validação de DTO.

## Porquê cada porta existe
- `UsersRepository`: Postgres via Kysely, substituível/testável com fake — critério 1 e 3 do ADR-016.
- `AuditPort`: idem, delegado ao módulo `audit` pela raiz.
- Não há porta para hashing de password aqui — isso é o módulo `auth` (`argon2` chamado direto do `domain`, sem indireção; ver `modules/auth/README.md`).
