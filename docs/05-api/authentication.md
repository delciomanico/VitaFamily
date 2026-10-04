# Vita Family — Autenticação (Fase 13/14)

> **ATUALIZAÇÃO 2026-10-04 (ADR-012, decisão do proprietário):** a implementação é em **Go** (pgx+sqlc+goose, river, chi+oapi-codegen), **sem Redis**, em **VPS própria** com Caddy, domínio `vitafamily.cassfrei.com`. Onde este documento diz NestJS, Prisma, Redis, BullMQ ou Jest, ler o equivalente Go de ADR-012; a arquitetura lógica mantém-se.

> Estado: **v0.1 — decisões adotadas com a recomendação do assistente.** Racional em ADR-007.

## 1. Mecanismo
| Elemento | Especificação |
|---|---|
| Identificador | E-mail (único, normalizado em minúsculas). |
| Palavra-passe | **argon2id** (memória 64 MiB, 3 iterações, paralelismo 1), salt único por hash. Política: mín. **12 caracteres**, máx. 128, rejeitar palavras-passe comuns/vazadas (lista local); sem regras de composição. |
| Access token | JWT assinado (`kid` para rotação de chave), **15 minutos**; claims: `sub` (userId), `sid` (sessão), `iat`, `exp`. **Sem papéis no token**: papéis, família e estado são lidos da BD por pedido (cache ≤60 s para estado de conta). |
| Refresh token | Opaco, 256 bits aleatórios, **30 dias**, guardado **hasheado** (`sessions`), enviado em cookie `refresh_token`: `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`. **Rotativo**: cada `/auth/refresh` emite novo e invalida o anterior. Reutilização de um refresh já rodado ⇒ **revoga toda a cadeia** (`token_chain_id`). |
| Cliente | O access token fica **em memória** (nunca em `localStorage`). Ao reabrir a PWA, chama `/auth/refresh`. |
| CSRF | O refresh exige `X-Requested-With: vita` e `SameSite=Strict`; os restantes pedidos usam `Authorization: Bearer` (imunes a CSRF clássico). |
| Logout | Revoga a sessão e limpa o cookie. "Terminar todas as sessões" por mudança/recuperação de palavra-passe. |

## 2. Fluxos
- **Registo:** `POST /auth/register` ⇒ conta `PENDING_VERIFICATION` + e-mail de verificação (token de uso único, 24 h) ⇒ `POST /auth/verify-email` ⇒ `ACTIVE`. Resposta sempre neutra (sem revelar se o e-mail existe).
- **Login:** só `ACTIVE`. Mensagem de erro genérica para credenciais inválidas. Conta `SUSPENDED` ⇒ recusado.
- **Recuperação:** `forgot` (neutro) ⇒ e-mail com token de uso único, **1 h** ⇒ `reset` ⇒ todas as sessões revogadas.
- **Termos (B6):** se `termsAcceptedVersion` ≠ versão atual ⇒ API devolve `TERMS_REACCEPTANCE_REQUIRED` exceto `POST /users/me/terms-acceptance`, exportação e eliminação da conta.
- **Convite de conta de dependente:** `register` com `invitationToken`; a data de nascimento vem do perfil; idade ≥13 (B3).

## 3. Limites (rate limiting, NFR-SEC-05)
| Endpoint | Limite |
|---|---|
| `POST /auth/login` | 5 falhas / 15 min por (e-mail + IP), com atraso crescente; 20 / 15 min por IP. |
| `POST /auth/register` | 5 / hora por IP. |
| `POST /auth/password/forgot` e `/resend-verification` | 3 / hora por e-mail; 10 / hora por IP. |
| `POST /auth/refresh` | 30 / hora por sessão. |
| `POST /invitations/lookup` e `/accept` | 20 / hora por IP. |
| Geral (autenticado) | 300 pedidos / minuto por utilizador. |
| Uploads | 20 / hora por utilizador. |
| Exportações | 3 / dia por utilizador. |

Contadores em Redis; falha do Redis ⇒ falha **fechada** nos endpoints de autenticação (recusa) e aberta com limite local nos restantes `[PROPOSTO]`.

## 4. O que a autenticação **não** inclui no MVP
Autenticação multifator (MFA) · login social · SSO · passkeys. `[NEEDS DECISION futura]` — **recomendação:** MFA opcional por TOTP é a primeira evolução de segurança (dados de saúde); não entra no MVP por não estar no âmbito aprovado.
