# Módulo `notifications`

M8 (`plan.md` §4): canais e entrega (push/e-mail), preferências, subscrições, retry (FR-ALR). Depende só de `users` (`modules.md` §2) — **nunca** de `alerts` (a orquestração do pipeline Evento→Regra→Alerta→Notificação fica em `alerts`, que depende deste módulo pela raiz, nunca o inverso — `modules.md` §3 nota 15).

## Por que `notifications` nunca lê a tabela `alerts`

O FK `notifications.alert_id → alerts` (entities.md) sugeriria `notifications` ler `alerts` para decidir `SKIPPED` (conta suspensa, canal desativado — `state-machines.md` "Notification"). Mas isso fecharia um ciclo com a aresta já necessária `alerts → notifications` (criar/cancelar notificações). Resolução (nota 15): a tabela `notifications` ganhou uma coluna `recipient_user_id` **desnormalizada**, escrita uma única vez em `enqueueForAlert` — fora do desenho original de `schema.md` §4, documentado também aí. Com isto, `notifications.send` decide tudo a partir da própria linha + `users`, sem nunca tocar em `alerts`.

## `notification_preferences` já existia (M1) — ownership corrigido

`0002_identity.sql` (M1) já criava `notification_preferences` em antecipação a este módulo, mas `users/infrastructure/` chegou a declarar o seu tipo Kysely e a inserir uma linha por omissão no registo — duas violações de `conventions.md` §3.5 (só o repositório do módulo dono acede à tabela). Corrigido nesta implementação: a declaração/escrita saiu de `users`; este módulo é agora o único a aceder à tabela, com `defaultPreference()` (R9, tudo a `true`) como fallback em memória para um `User` sem linha própria (equivalente ao que a inserção por omissão fazia). Ver nota em `users/infrastructure/schema.ts` e `modules.md` §3 nota 15.

## Tipo vs. canal (Q3/UC-ALR-05)

Dois interruptores diferentes, com efeitos diferentes:
- **Tipo** (`medicationDue`/`appointmentReminder`/`examReminder`) — verificado por `alerts` **antes** de criar o `Alert` (`isTypeEnabled`). Desativado ⇒ o alerta nem chega a existir para esse destinatário (Q3: "podem ser desativados totalmente"). `APPOINTMENT_OUTCOME_REQUEST` partilha o interruptor de `appointmentReminder` (entities.md não prevê um próprio).
- **Canal** (`pushEnabled`/`emailEnabled`) — decide que linhas `notifications` se criam (`enqueueForAlert`) e é **reavaliado no envio** (`send-job.ts`, SKIPPED "canal desativado") — o `Alert` continua a existir na app mesmo sem nenhum canal ativo (UC-ALR-02 alternativo).

## Retry (ST6) e "falha de um canal não impede o outro" (BR-ALR-05)

`notifications.send` (worker, 1 min — mesmo critério de scanner do ADR-009 aplicado aqui, nunca uma fila externa) processa `PENDING`/`FAILED` devidas (`listDueForSending`, `indexes.md`). Cada `Notification` (uma por canal) falha/repete isoladamente — nunca em bloco. Backoff fixo `domain/notification.ts#RETRY_BACKOFF_MS` (1, 5, 15, 60, 240 min; máx. 5 retries); ao esgotar, fica `FAILED` terminal sem `next_attempt_at` (nunca mais reselecionado — `NULL <= now` é falso em SQL).

## Texto genérico (N8/BR-ALR-08)

`send-job.ts` usa **uma única mensagem fixa**, igual para todos os tipos de alerta — nenhum nome, medicamento ou hora, nunca. O detalhe (nome do membro, mensagem por tipo) só existe dentro da app (`alerts/application/list-alerts.ts`).

## Mapa de um pedido típico
```
PUT /users/me/notification-preferences
  → interface/router.ts
    → application/put-preferences.ts
      → infrastructure/repo.ts (upsert notification_preferences)
```
```
notifications.send (worker, 1 min)
  → application/send-job.ts
    → users.byId (conta suspensa?) / preferencesRepo (canal ativo?)
      → mailer.send | pushSender.send (por canal, isolado)
        → infrastructure/repo.ts (markSent/markSkipped/markRetry/markFailedTerminal)
```

## Camadas presentes
- `domain/preference.ts` — `NotificationPreference`, `isTypeEnabled`, `activeChannels`.
- `domain/notification.ts` — `decideRetry` (ST6, puro).
- `domain/push-subscription.ts` — `PushSubscription`.
- `application/for-alerts.ts` — API pública para `alerts` (`isTypeEnabled`/`enqueueForAlert`/`skipPendingForAlert`).
- `application/send-job.ts` — job `notifications.send`.
- `infrastructure/mailer-smtp.ts`/`push-sender.ts` — adaptadores `Mailer`/`PushSender` (nodemailer/web-push).
- `interface/` — as 4 rotas de `/users/me/notification-preferences`/`/users/me/push-subscriptions...` em `endpoints.md` (posse dos dados é deste módulo; a tag OpenAPI é "Users" por desenho do contrato).

## Migração
`db/migrations/0009_alerts_and_notifications.sql`: `push_subscriptions`, `alerts`, `notifications` (+ `recipient_user_id`). `notification_preferences` já existia desde `0002_identity.sql` (M1).
