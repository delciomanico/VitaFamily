# Módulo `auth`

Registo, verificação de e-mail, login, refresh rotativo (ADR-007), recuperação/mudança de password, logout e resolução do estado do ator (suspensão, admin, termos pendentes — B6) para o middleware de `platform/http`.

## Mapa de um pedido típico
```
POST /auth/refresh
  → interface/router.ts                      # lê cookie de refresh, chama o caso de uso
    → application/refresh.ts                  # caso de uso: valida CSRF (X-Requested-With), relógio, rate limit
      → application/ports.ts                  # SessionRepository / UsersPort / AuditPort / Clock (o que o caso de uso precisa)
        → domain/token.ts                      # hash do token apresentado (computação pura, sem porta)
        → infrastructure/repo.ts               # KyselySessionRepository — procura/revoga/insere sessão
        → domain/jwt.ts                        # assina o novo access token (computação pura, sem porta)
```

```
POST /auth/login
  → interface/router.ts
    → application/login.ts
      → domain/password.ts                    # argon2.verify — computação pura, chamada direta, sem porta
      → application/ports.ts → infrastructure/repo.ts   # procura utilizador, regista sessão
```

```
qualquer rota autenticada de outro módulo
  → platform/http: OpenApiValidator → security handler
    → interface/middleware.ts (createBearerAuthSecurityHandler)
      → domain/jwt.ts (verifyAccessToken)      # computação pura: valida assinatura/kid/expiração
    → interface/middleware.ts (createActorContextMiddleware)
      → application/resolve-actor-state.ts     # cache de 60s (ACCOUNT_STATE_CACHE_TTL_MS): suspenso? admin? termos pendentes?
```

## Camadas presentes
- `domain/` — `password.ts`, `jwt.ts`, `token.ts`, `cookie.ts`, `rate-limiter.ts`, `ttl-cache.ts`, `session.ts`, `registration-rules.ts`, `common-passwords.ts`: tudo computação pura, sem I/O. `argon2`/`jose`/`node:crypto` são chamados **diretamente daqui**, sem porta (ADR-016: não vão ser trocados, e a regra "sem I/O" já os protege).
- `application/` — um ficheiro por caso de uso (`register`, `login`, `refresh`, `logout`, `forgot-password`, `reset-password`, `change-password`, `verify-email`, `resend-verification`, `resolve-actor-state`) + `ports.ts`.
- `infrastructure/` — `repo.ts` (sessões e tokens via Kysely), `mailer-smtp.ts`/`mailer-fake.ts` (implementam `Mailer`).
- `interface/` — `router.ts`, `middleware.ts` (security handler + actor context), `cookies.ts`.

## Porquê cada porta existe (`application/ports.ts`)
- `SessionRepository`, `AuthTokenRepository`: Postgres via Kysely — critério 1 do ADR-016.
- `Mailer`: dois adaptadores reais (`SmtpMailer` em produção, `FakeMailer` em testes) — critério 2.
- `UsersPort`, `AuditPort`: outros módulos, só acessíveis pela raiz — critério 1 (módulo "externo" do ponto de vista de `auth`).
- Sem porta para `argon2`/`jose`: ver `domain/` acima.
