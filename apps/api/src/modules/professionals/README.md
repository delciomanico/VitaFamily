# Módulo `professionals`

MK1 do mercado de profissionais (ADR-037; `modules.md` nota 35; `plan.md` «MK1»). Dono das 13 tabelas `professional_*`, `professionals`, `specialties`, `validation_cases` (`schema.md` §11), das rotas `/professional-portal/*` e `/admin/professionals*`, `/admin/specialties*`. **Sem dados de saúde nem de família.**

## O que faz

- **Identidade própria** do profissional (`ProfessionalAccount`, sessões, e-mail com código de 6 dígitos, recuperação de palavra-passe). Não usa `auth`: BR-MKT-13.
- **Perfil** (nome, bio, cidade, instruções de pagamento), **especialidades** (catálogo gerido pelo admin, `HEALTH`/`WELLNESS`).
- **Credenciais** (identidade, cédula, certificação): upload com validação por conteúdo, quarentena, antivírus e download mediado.
- **Validação pelo admin**: fila, detalhe, decisões (`APPROVE`, `REJECT`, `REQUEST_INFO`, `SUSPEND`, `REACTIVATE`) com histórico em `validation_cases`.
- **Ofertas** (método, duração, preço em Kz), **regras de horário** semanais e **bloqueios**; geração idempotente de horários em `Africa/Luanda`.
- **Leitor público** (`ProfessionalDirectory`, na raiz): só profissionais `APPROVED`, só dados públicos (BR-MKT-19).

Não faz em MK1: rotas para famílias, marcações (MK3), mensagens (MK3/MK4), descoberta (MK2).

## Mapa de pastas

```
index.ts              raiz pública: createProfessionalsModule, createProfessionalsJobs, ProfessionalDirectory
domain/               funções puras e tabelas de estados (sem I/O): validation-status, requirements, offer, schedule,
                      credential, file-type, password (argon2), token, jwt (jose), cookie, rate-limiter, ttl-cache
application/          casos de uso (um ficheiro por área) + ports.ts (todas as portas)
infrastructure/       implementações: Kysely (repos), storage-file-store, clamav-client, jobs (pg-boss), mailer-smtp/fake
interface/            routers Express, middleware de ator/segurança, cookies
```

## Fluxo de um pedido: `POST /professional-portal/offers`

```
interface/offers-router.ts               valida o contrato (OpenAPI) e chama o caso de uso
  interface/middleware.ts                ator do token (aud `professional-portal`) + estado da conta (cache ≤ 60 s)
    application/offers.ts (createOffer)  transação; findByIdForUpdate(profissional); auditDeniedOnLock
      domain/validation-status.ts        assertCanWrite (oferta: PROFESSIONAL_LOCKED em REJECTED/SUSPENDED, matriz authorization.md §10.2)
      domain/offer.ts                    validateOfferInput (preço 0–100 000 000, duração, limite de 20 ativas)
        infrastructure/offer-repo.ts     KyselyOfferRepository (FK composta à especialidade do profissional)
          audit.record(...)              PROFESSIONAL_OFFER_CREATE (sem preço nem nota)
```

## Rotas (34 operações do contrato)

| Router | Rotas |
|---|---|
| `interface/router.ts` (auth) | `POST /professional-portal/auth/{register, verify-email, resend-verification, login, refresh, logout, password/forgot, password/reset}` (8) |
| `interface/profile-router.ts` | `GET` e `PATCH /professional-portal/me`, `PUT /professional-portal/me/specialties`, `POST /professional-portal/submission` (4) |
| `interface/specialties-router.ts` | `GET /professional-portal/specialties`; `GET`, `POST /admin/specialties`; `PATCH /admin/specialties/{specialtyId}` (4) |
| `interface/credentials-router.ts` | `GET`, `POST /professional-portal/credentials`; `DELETE .../credentials/{credentialId}`; `GET .../credentials/{credentialId}/file` (4) |
| `interface/offers-router.ts` | `GET`, `POST /professional-portal/offers`; `PATCH .../offers/{offerId}` (3) |
| `interface/schedule-router.ts` | `GET`, `POST .../schedule-rules`; `PATCH .../schedule-rules/{ruleId}`; `GET`, `POST .../time-off`; `DELETE .../time-off/{timeOffId}`; `GET .../slots` (7) |
| `interface/admin-professionals-router.ts` | `GET /admin/professionals`; `GET /admin/professionals/{professionalId}`; `POST .../decisions`; `GET .../credentials/{credentialId}/file` (4) |

Autorização: as rotas `/admin/*` usam o `bearerAuth` de User e o guard `PLATFORM_ADMIN`; o admin não tem rota para editar perfil, ofertas, horários, credenciais nem para ler `paymentInstructions`.

## Portas e onde são implementadas

| Porta (`application/ports.ts`) | Implementação | Ligação |
|---|---|---|
| `ProfessionalMailer` | `infrastructure/mailer-smtp.ts` (nodemailer); `mailer-fake.ts` (testes) | `main/api.ts` |
| `CredentialFileStore` | `infrastructure/storage-file-store.ts` (sobre `platform/storage`) | interna ao módulo |
| `CredentialScanner` | `infrastructure/clamav-client.ts` (`CredentialClamAvScanner`) | `main/worker.ts` |
| `CredentialScanQueue` | `infrastructure/jobs.ts` (`PgBossCredentialScanQueue`) | `main/api.ts`, `main/worker.ts` |
| `*Repository` (contas, perfil, credenciais, ofertas, horários, admin, leitor, manutenção) | `infrastructure/*-repo.ts` (Kysely) | interna ao módulo |
| `OfferSlotSync` e `ApprovalSlotGenerator` | `application/schedule-sync.ts` (`reconcileSchedule`, sobre `domain/schedule.ts`) | ligadas em `createProfessionalsModule` |

Não há porta para `argon2`, `jose` nem `node:crypto` (chamadas diretas em `domain/`, `conventions.md` §3.2). Não há porta `ScheduleGenerator`: ver «Decisões» (OP-74).

## Jobs (`professionals.*`, `main/worker.ts`)

| Job | Quando (UTC) | O que faz | Auditoria |
|---|---|---|---|
| `professionals.scan-credential` | fila (ao enviar uma credencial) | antivírus; `PENDING` → `CLEAN` ou `INFECTED`; quarentena | não |
| `professionals.delete-files` | `*/5 * * * *` | esvazia a outbox `professional_file_deletions` | não |
| `professionals.expire-credentials` | diário 02:30 | `APPROVED` com credencial caducada → `NEEDS_INFO` + `validation_cases` (BR-MKT-21) | `PROFESSIONAL_CREDENTIAL_EXPIRED` (SYSTEM, com contagem) |
| `professionals.generate-slots` | diário 02:40 | mantém a janela rolante de 8 semanas (BR-MKT-25); idempotente | `PROFESSIONAL_SCHEDULE_GENERATE` (SYSTEM) |
| `professionals.cleanup` | diário 03:10 | apaga tokens e sessões expirados; volta a enfileirar credenciais `PENDING` há mais de 10 min (job de antivírus perdido) | não |

Ficheiros: a credencial é guardada em quarentena (`professional-credentials/quarantine/...`), só passa a `CLEAN` com o antivírus; a remoção de ficheiros passa pela outbox própria `professional_file_deletions` (OP-58: `documents` não é alterado nem importado).

## Segurança

- **Identidade separada:** JWT com `aud = professional-portal` (OP-73), claims `professionalAccountId`/`professionalId`/`sid`; um token de User ou de clínica é recusado em `/professional-portal/*`, e vice-versa.
- **Estado de validação lido da BD em cada escrita:** `findByIdForUpdate` (`FOR UPDATE` por profissional) + `assertCanWrite`; falha ⇒ `PROFESSIONAL_LOCKED` (409), auditado como `ACCESS_DENIED` (`DENIED`) numa transação à parte. Só o estado da **conta** (`ACTIVE`) tem cache de 60 s.
- **Isolamento:** todo o recurso é procurado pelo `professionalId` do token; outro profissional ou inexistente ⇒ `NOT_FOUND` idêntico.
- **Anti-enumeração:** registo, reenvio e recuperação respondem de forma neutra; a verificação de palavra-passe gasta o mesmo tempo de argon2 quando a conta não existe.
- **Sem PII em auditoria nem em logs:** nunca e-mail, nome, bio, cidade, `paymentInstructions`, número/entidade da credencial, nome do ficheiro, preços, notas, motivos. `metadata` guarda nomes de campos e contagens. Verificado pelo canário de `tests/integration/professionals-pii-canary.integration.test.ts`.
- **Credenciais:** validação por conteúdo (assinatura do ficheiro, não o `Content-Type`), limite de tamanho, quarentena, antivírus; o download do profissional só para `CLEAN` e com `Cache-Control: private, no-store`; o download do admin é sempre auditado com o id da credencial.

## Decisões registadas

- **OP-58** (decidida pelo proprietário): `CredentialFileStore` e fila/outbox próprios; `documents` não é usado.
- **OP-74** (aceite por omissão, a ratificar): (a) o gerador de horários é do próprio módulo (`domain/schedule.ts`, `Africa/Luanda` sem DST), reutilizando só `platform/time`; `clinics` não é alterado. (b) `deriveRequirements` reporta todas as causas (pendente, infetada, caducada). (c) o leitor público mostra as especialidades ligadas mesmo desativadas no catálogo.
- **OP-59:** `SUSPENDED`/`REJECTED` ficam em só leitura; não há `ACCOUNT_SUSPENDED` para o profissional.

## Fora de âmbito em MK1

Rotas para famílias (MK2/MK3), marcações e comprovativos, mensagens, avaliações e ranking, partilha de histórico (`record-sharing`), receita digital (`prescriptions`, após parecer jurídico).

## Testes

`tests/professionals-architecture.test.ts` (fronteiras, sem BD), `tests/integration/professionals-*.integration.test.ts` (PostgreSQL real), em particular `professionals-openapi` (34 operações, tokens cruzados, `additionalProperties`) e `professionals-pii-canary` (PII em auditoria, logs e e-mails).
