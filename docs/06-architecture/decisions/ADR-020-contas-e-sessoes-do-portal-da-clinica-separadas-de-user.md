# ADR-020 — Contas e sessões do portal da clínica (`ClinicAccount`) separadas de `User`

**Estado:** Aceite — decisão **do proprietário** (2026-10-12, change control D18). Amplia D17 (`00-product/discovery.md`).

## Contexto
D17 introduziu o portal da clínica parceira (confirmar/recusar pedidos, publicar horários) mas deixou
em aberto quem são as contas do lado da clínica. O protótipo de frontend (`apps/web/src/mocks`)
assumiu, por omissão, que seria um `User` comum com um registo `ClinicStaff(userId, clinicId, role)`
— i.e., o mesmo espaço de identidade da família. D18 corrigiu essa suposição: as contas do portal da
clínica são um **segundo tipo de ator**, sem qualquer ligação a `users`/`family_members`.

O ator do pedido já tem um mecanismo (`ActorInfo` + `AsyncLocalStorage`, equivalente a
`httpx.ActorInfo`/`httpx.WithActor` do ADR-012) em `apps/api/src/platform/actor/index.ts`, preenchido
pelo middleware de autenticação de `auth` (M1) com `userId`/`sessionId`/`familyId`/`memberId`/
`platformAdmin`. É preciso decidir como o portal da clínica coexiste com isto sem misturar os dois
mundos.

## Decisão
| Tema | Escolha |
|---|---|
| Entidade | `ClinicAccount` — tabela própria `clinic_accounts` (`clinicId`, `email`, `passwordHash`, `role` `CLINIC_ADMIN`\|`CLINIC_MANAGER`, `status`), **sem FK** para `users` nem para `family_members`. Uma pessoa que também seja `User` de uma família tem, se for o caso, duas identidades distintas e não relacionadas pelo sistema. |
| Sessões | Tabela própria `clinic_sessions` (equivalente a `sessions`, mas para `clinic_accounts`); refresh token rotativo próprio, independente da cadeia de sessões de `User`. |
| Transporte do ator | **Segundo `ActorInfo`**, com o seu próprio tipo e o seu próprio `AsyncLocalStorage`, nunca reutilizando `getActor()`/`runWithActor()` existentes. Proposto: módulo `clinic-portal` expõe `getClinicActor()`/`runWithClinicActor()` com `ClinicActorInfo { clinicAccountId, clinicId, role, sessionId }`. O middleware de autenticação de `/clinic-portal/*` só preenche este segundo contexto; o middleware de `User` só preenche o primeiro. Numa mesma cadeia assíncrona nunca os dois estão preenchidos ao mesmo tempo, porque são árvores de rotas disjuntas (ver abaixo). |
| Fronteira de rotas | Todas as rotas do portal da clínica vivem sob o prefixo **`/clinic-portal/*`** (`auth`, `staff`, `slots`, `requests`, `agenda`). Nenhuma rota de família/User lê `ClinicActorInfo`; nenhuma rota de `/clinic-portal/*` lê `ActorInfo` de User. `AccessPolicy.can(...)` (módulo `access`, ADR-008) continua a decidir só sobre o ator de User/família; o portal da clínica usa a sua própria verificação de autorização (papel `CLINIC_ADMIN`/`CLINIC_MANAGER` + pertença à clínica do caminho), documentada em `08-security/authorization.md` §2. |
| JWT | Claims distintas e não interpretáveis como as do User: `clinicAccountId`, `clinicId`, `role` (nunca `userId`/`sessionId`/`familyId`). Um token de clínica apresentado numa rota de User (ou vice-versa) falha a validação de claims, não só de assinatura — evita confusão mesmo que a chave de assinatura seja partilhada. |
| Módulo | `clinic-portal` (novo, ou secção própria dentro de `clinics` — detalhe de implementação, decidido em M7 conforme ADR-016 §3.2), dependências declaradas em `modules.md` §3. Não importa `auth`/`access`/`families` (módulos de User); só lê `clinics`/`appointments` pela sua `index.ts`. |

## Consequências
- Isolamento total entre os dois mundos: uma fuga ou bug no portal da clínica não expõe sessões/tokens de família, e vice-versa.
- Platform Admin continua a gerir só a clínica (ver/suspender) e a conta `CLINIC_ADMIN` raiz (BR-CLN-05); não lista nem edita `CLINIC_MANAGER` individualmente — isso é self-service do `CLINIC_ADMIN` da própria clínica.
- O protótipo de frontend (`apps/web/src/mocks/handlers/clinicPortal.ts`, `apps/web/src/types/clinic.ts`) modelou o login como se fosse um `User` com `ClinicStaff(userId, clinicId, role)` — **divergente** desta decisão; fica como nota para a fase de frontend (fora do âmbito desta revisão de documentação, que só cobre `docs/`).
- `08-security/authorization.md`, `07-database/schema.md` e `05-api/openapi.yaml`/`endpoints.md` refletem `ClinicAccount`/`clinic_sessions`/`/clinic-portal/*` (D18).
- Auditoria: eventos do portal da clínica usam `actor_type` próprio (ver `audit.md`/`schema.md` `actor_type` enum — acrescentar `CLINIC_ACCOUNT` por change control futuro se `audit.md` precisar, não decidido aqui).
