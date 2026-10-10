# ADR-018 — Código de verificação de e-mail de 6 dígitos (substitui o link de UC-ACC-01)

**Estado:** Aceite — decisão **do proprietário** (2026-10-10). Substitui, só para `/auth/verify-email`,
o token opaco de uso único descrito em UC-ACC-01/`authentication.md` v0.1.

## Contexto
A `frontend_main` (apps/web) foi construída com um ecrã de verificação por **código numérico de 6
dígitos** (`VerifyPage.tsx`, decisão já tomada e documentada no próprio commit do frontend), enquanto
a API (M1, `apps/api`) implementava UC-ACC-01 literalmente: um token opaco de 256 bits enviado como
link/código longo por e-mail, sem o `email` no pedido de verificação. As duas implementações foram
feitas em branches separadas e só a integração (ligar `apps/web` à API real) revelou a divergência.

## Decisão
| Tema | Escolha |
|---|---|
| Formato do código | 6 dígitos numéricos (`000000`–`999999`), gerado com `node:crypto` `randomInt` (`domain/token.ts#generateVerificationCode`). |
| Validade | 24 h, uso único — inalterado de UC-ACC-01. |
| Âmbito da procura | **Sempre por `(email, código)`**, nunca só pelo hash do código a nível global: 10^6 valores não chegam para garantir unicidade entre contas diferentes a verificar em simultâneo. `POST /auth/verify-email` passa a exigir `email` (antes só `token`). |
| Reenvio | Sem alteração: `resend-verification` continua a invalidar o código anterior antes de gerar um novo (`invalidateAllForUser`). |
| Recuperação de palavra-passe | **Sem alteração** — continua a usar o token opaco de 256 bits (não tem UI de 6 dígitos no frontend). |

## Alternativas
Mudar o frontend para aceitar o token longo (abandonar o ecrã OTP) — rejeitado: o ecrã de 6 dígitos já
é uma decisão deliberada do proprietário sobre a experiência de registo, não um detalhe de
implementação; gerar um código curto mapeado para o token longo no backend seria indireção sem
benefício sobre simplesmente mudar o formato do token nessa rota.

## Consequências
- `docs/05-api/openapi.yaml`: `VerifyEmailRequest` passa a exigir `email` e `token` (antes só `token`).
- `docs/03-use-cases/family.md` (UC-ACC-01) e `docs/05-api/authentication.md` §2 atualizados para
  descrever o código de 6 dígitos em vez do link.
- `AuthTokenRepository` ganha `findValidForUser` (procura restrita a `userId`); `findValidByHash`
  mantém-se para `PASSWORD_RESET` (token longo, sem este risco de colisão).
- Nenhum impacto em `/auth/password/*` nem nas sessões/refresh tokens (ADR-007).
