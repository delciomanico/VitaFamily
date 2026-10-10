# Módulo `alerts`

M8 (`plan.md` §4): Evento → Regra → Alerta (FR-ALR, ADR-009). Depende de `medications`, `appointments`, `examinations`, `families` e `notifications` (`modules.md` §2, nota 15 — a orquestração do pipeline fica aqui, que chama `notifications` pela raiz; nunca o inverso).

## Scanner idempotente (ADR-009)

`alerts.scan` (worker, 1 min) lê candidatas através das **interfaces de consulta** dos módulos donos (`modules.md` §3 nota 3) — nunca acede a `dose_occurrences`/`appointments`/`examinations` diretamente:
- `medications.listReminderCandidates`: tomas `PENDING`/`UNCONFIRMED` com `scheduledAt <= now` (mesmo índice do `mark-unconfirmed`).
- `appointments.listReminderCandidates`: consultas `SCHEDULED` futuras (até 24h) **ou** passadas há mais de 24h sem `outcome_requested_at`.
- `examinations.listReminderCandidates`: exames `SCHEDULED` com `examDate` numa janela de ±2 dias (a instância exata recalcula-se com o fuso efetivo do sujeito).

Para cada candidata, `domain/rule.ts` calcula os `Rule` (ruleKey + triggerAt) com valores fixos (R9, BR-APT-05) — nunca configuráveis em BD. `domain/recipients.ts` decide os destinatários (titular; dependente ⇒ tutores + o próprio se tiver conta, FR-ALR-08) a partir de `families.findMemberById`/`listGuardianUserIds`.

Para cada `(rule, recipient)` já devido (`triggerAt <= now`): se `notifications.isTypeEnabled` for falso, **nem o alerta é criado** (Q3: "podem ser desativados totalmente") — só a preferência de canal (push/e-mail) é que deixa o alerta existir sem notificação externa (UC-ALR-02 alternativo). `dedupeKey` (`ruleKey:sourceId:recipientUserId:triggerAt`) é `UNIQUE` (schema.md §4) — o `insertIfNew` do repositório devolve `null` se já existir (idempotente, ADR-009). Só quando o `insert` é mesmo novo é que `notifications.enqueueForAlert` é chamado.

## Decisões de interpretação (sem especificação explícita no detalhe, documentadas aqui em vez de inventadas sem registo)

- **`exam.24h` sem hora do exame:** `examinations.examDate` é só uma data (entities.md). "24h antes" lê-se como "à meia-noite local (fuso efetivo do sujeito, Q8) do dia anterior ao exame" (`domain/timezone.ts#localMidnightUtc`) — a única interpretação literal possível a partir do único dado disponível, sem introduzir uma hora de referência arbitrária.
- **`dose.due`/`dose.repeat` só se ainda não confirmada:** a candidata já vem filtrada por `PENDING`/`UNCONFIRMED` (mesmo critério do índice de `mark-unconfirmed`) — uma toma confirmada antes do horário (ST3 permite até 1h antes) não gera lembrete nenhum, consistente com TC-ALR-01 ("sem repetição se confirmada") aplicado também ao primeiro alerta, não só à repetição.
- **Recálculo ao editar/cancelar (BR-APT-03):** não há nenhuma linha "a apagar" — como o `dedupeKey` inclui `triggerAt` (derivado do `scheduledAt`/`examDate` **atual**, lido de novo em cada scan) e as candidatas exigem `status` ativo (`SCHEDULED`), editar ou cancelar o recurso muda o que o próximo scan vê, sem `alerts` precisar de um gatilho de "invalidação" (mesmo espírito do ADR-009: "scanner sobre estado persistente... recuperável").

## Mapa de um pedido típico (scanner)
```
alerts.scan (worker, 1 min)
  → application/scan-job.ts
    → medications/appointments/examinations.listReminderCandidates (pela raiz)
      → domain/rule.ts (Rule[] por candidata)
        → families.findMemberById / listGuardianUserIds (destinatários)
          → notifications.isTypeEnabled
            → infrastructure/repo.ts (insertIfNew, dedupe_key)
              → notifications.enqueueForAlert (pela raiz, só se inserido de novo)
```
```
GET /alerts → interface/router.ts → application/list-alerts.ts (memberName via families, mensagem fixa por tipo)
POST /alerts/{id}/read → application/mark-alert-read.ts → notifications.skipPendingForAlert
```

## Camadas presentes
- `domain/rule.ts` — `Rule`/`RuleKey`, uma função por regra (valores fixos), `buildDedupeKey`.
- `domain/recipients.ts` — `resolveRecipients` (FR-ALR-08).
- `domain/timezone.ts` — `localMidnightUtc` (duplicação mínima da técnica de `medications/domain/schedule.ts`, módulos só se importam pela raiz).
- `domain/alert.ts` — entidade `Alert`.
- `application/scan-job.ts` — orquestração do pipeline (único ficheiro que conhece as 3 fontes de candidatas).
- `application/list-alerts.ts`/`mark-alert-read.ts`/`mark-all-alerts-read.ts` — UC-ALR-03/04.
- `infrastructure/repo.ts` — `KyselyAlertsRepository` (cursor de 3 chaves: não lido primeiro, `trigger_at` desc, `id`).
- `infrastructure/jobs.ts` — registo pg-boss de `alerts.scan`.
- `interface/` — as 3 rotas de "Alerts" em `endpoints.md`.

## Migração
`db/migrations/0009_alerts_and_notifications.sql`: `alerts` (+ `push_subscriptions`/`notifications`, ver `notifications/README.md`).
