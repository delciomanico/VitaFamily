# Módulo `messaging`

MK2 do mercado de profissionais (ADR-037; `modules.md` notas 34 e 36; `plan.md` «MK2»). Conversas de texto 1–1 entre uma família (por membro) e um profissional `APPROVED`; denúncias e moderação pelo admin. Dono das tabelas `conversations`, `messages`, `message_reports` (migração `0044`, `schema.md` §12). Sem anexos (BR-MKT-39).

## O que faz

- **Família**: abre a conversa (1 por membro + profissional), envia, lê, fecha, reabre, denuncia. Autoriza-se com a ação `MESSAGE_PROFESSIONALS` (só `SELF`/`TUTOR_OF`); conversa de outro membro/família ⇒ `404` sem enumeração.
- **Profissional**: só responde (não abre); a conversa procura-se sempre por `professionalId` do token; nunca vê ids de família, membro ou utilizador, só o `participantLabel`. Não `APPROVED` ⇒ lê, marca lido e denuncia; enviar/fechar/reabrir ⇒ `PROFESSIONAL_LOCKED`.
- **Admin**: só vê, por denúncia, a mensagem denunciada e as 2 anteriores da mesma conversa (detalhe auditado); decide `DISMISS`, `HIDE_MESSAGE`, `HIDE_AND_CLOSE`.
- **Privacidade (BR-MKT-46)**: texto, `participantLabel` e `note` nunca vão para logs, auditoria, erros, alertas nem e-mails.
- **Concorrência**: `seq` sem lacunas sob `FOR UPDATE` da linha da conversa; abertura serializada por bloqueio consultivo `(família, membro)`; ordem dos bloqueios `conversation-open:*` < `message-user:*` < linha; idempotência por `clientMessageId`.

## Mapa de pastas

```
index.ts            raiz pública: createMessagingModule, createMessagingWorkerModule, portas e SmtpProfessionalMailer
domain/             funções puras: conversation (estados, seq, lido), limits, text, message, report (sem platform nem I/O)
application/        casos de uso (family-, professional-conversations, moderation, notify-professional, purge-expired, export) + ports
infrastructure/     repo.ts e moderation-repo.ts (Kysely), jobs.ts (pg-boss), mailer-smtp.ts, schema.ts
interface/          family-router, professional-router, admin-router (Express)
```

## Rotas (20 operações do contrato)

| Router | Rotas |
|---|---|
| `interface/family-router.ts` (9, User) | `GET`, `POST /families/{f}/members/{m}/conversations`; `GET .../conversations/{c}`; `GET`, `POST .../{c}/messages`; `PUT .../{c}/read`; `POST .../{c}/close`, `/reopen`; `POST .../{c}/messages/{msg}/reports` |
| `interface/professional-router.ts` (8, token de profissional) | `GET /professional-portal/conversations`; `GET .../{c}`; `GET`, `POST .../{c}/messages`; `PUT .../{c}/read`; `POST .../{c}/close`, `/reopen`; `POST .../{c}/messages/{msg}/reports` |
| `interface/admin-router.ts` (3, `PLATFORM_ADMIN`) | `GET /admin/message-reports`; `GET /admin/message-reports/{reportId}`; `POST .../{reportId}/decisions` |

Respostas `Cache-Control: no-store`. Nenhuma rota aceita `multipart`.

## Jobs (`infrastructure/jobs.ts`, registados em `main/worker.ts`)

| Fila | Quando | O que faz |
|---|---|---|
| `messaging.notify-professional` | após o envio da família (`singletonKey` por conversa, 30 s) | e-mail genérico ao profissional, ≤ 1 por 30 min por conversa (`professional_notified_at`), retry com recuo, sem conteúdo |
| `messaging.purge-expired` | diário 03:50 UTC | apaga conversas com `last_message_at` > 24 meses (cascata para mensagens e denúncias); auditoria `MESSAGES_PURGED` só com contagem |

## Portas e onde são implementadas

| Porta (`application/ports.ts`) | Implementação | Ligação |
|---|---|---|
| `ConversationAccess` | `access.policy.can(..., "MESSAGE_PROFESSIONALS")` | `main/api.ts` |
| `ProfessionalLookup` | `ProfessionalDirectory` (`getConversationIdentities`, e-mail de aviso) | `main/api.ts`, `main/worker.ts` |
| `MessageAlerts` | `alerts.raiseMessageEvent` / `markSourceRead` (`MESSAGE_RECEIVED`, um por conversa até ler) | `main/api.ts` |
| `ProfessionalMailer` | `infrastructure/mailer-smtp.ts` | `main/worker.ts` |
| `ProfessionalNoticeQueue` | `PgBossProfessionalNoticeQueue` | `main/api.ts` |
| `reads.conversations` (exportação do titular) | consumida por `lifecycle` como fonte opcional | `main/api.ts` |

## Fronteiras (testes `tests/messaging-architecture.test.ts`)

`messaging` só importa `audit` e `platform`; nenhum módulo importa `messaging` (só `main/`); `domain/` não importa nada fora de `domain/`.
