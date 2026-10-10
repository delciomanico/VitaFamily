# Módulo `medications`

M6 (`plan.md` §4): `MedicationPlan`, geração de `DoseOccurrence` (DST-aware), ações sobre tomas, adesão (FR-MED). Depende de `access` (autorização por categoria + `access.getEffectiveTimezone`, modules.md §2 nota 10) e `audit` — **nunca** de `families`/`users` diretamente (ver "Decisão de change control" abaixo). `prescriptions` depende deste módulo (modules.md §3.6: a orquestração fica em `prescriptions`, que chama `medications`); nunca o inverso (cíclo proibido, modules.md §3.6).

## Mapa de um pedido típico

```
POST /families/{familyId}/members/{memberId}/medication-plans
  → interface/router.ts                      # rota autenticada
    → application/create-plan.ts             # valida o desenho (domain/medication-plan.ts)
      → access/index.js (policy.can)         #   CREATE/MEDICATION -> ALLOW ou Forbidden/NotFound
        → infrastructure/repo.ts             # KyselyMedicationPlansRepository.insert (tx)
          → access/index.js (getEffectiveTimezone) # fuso efetivo do sujeito (Q8/DM6)
            → application/generation.ts      # gera as ocorrências dos próximos 14 dias (domain/schedule.ts, DST-aware)
              → audit.record(trx, …)         # PLAN_CREATE
```

```
POST /families/{familyId}/members/{memberId}/doses/{doseId}/taken
  → interface/router.ts
    → application/mark-dose-taken.ts -> dose-actions.ts
      → access/index.js (policy.can, CONFIRM_DOSE/MEDICATION) # titular, tutor OU dependente com conta
        → domain/dose-occurrence.ts (canActOnDose)            # ST3 (futuro >1h), Q2 (até fim do dia seguinte)
          → infrastructure/repo.ts (updateStatus)
            → audit.record(trx, …)                            # DOSE_TAKEN
```

```
medications.generate-doses (job diário, modules.md §5)
  → infrastructure/jobs.ts (pg-boss schedule+work)
    → application/generate-doses-job.ts     # sem `policy` (operação de sistema, sem ator)
      → plansRepo.listActiveForGeneration   # todos os planos ACTIVE, de todas as famílias
        → access.getEffectiveTimezone (por plano) + generation.ts (regenerar)
```

## Camadas presentes
- `domain/` — `schedule.ts` (conversão DST-aware hora-local↔UTC por ponto fixo sobre `Intl.DateTimeFormat`, sem biblioteca de fusos externa; geração de instantes FIXED_TIMES/INTERVAL dentro de uma janela); `dose-occurrence.ts` (janelas puras: 2h→UNCONFIRMED, confirmação até ao fim do dia seguinte, correção 7 dias, ST3 "futuro só até 1h antes"); `medication-plan.ts` (validação do desenho — BR-MED-01/02 — e transições ST1).
- `application/` — um ficheiro por caso de uso; `generation.ts` (regeneração partilhada por create/update/status/job — nunca duplica nem perde doses, BR-RX-05/BR-MED-08); `dose-actions.ts` (confirmar/não-tomar/corrigir, partilhado pelos 3 endpoints de ação); `for-prescription.ts` (API crua para `prescriptions`, recebe `trx` já aberto); `generate-doses-job.ts`/`mark-unconfirmed-job.ts` (jobs de sistema, sem `policy`); `support.ts` (`auditViewIfNotSelf`, audit.md §3).
- `infrastructure/` — `KyselyMedicationPlansRepository`/`KyselyDoseOccurrencesRepository` (paginação por cursor keyset `created_at,id` — primeiro módulo a implementar `{items,nextCursor}` a sério, `platform/page` ganhou `encodeCursor`/`decodeCursor` nesta tarefa); `jobs.ts` (registo pg-boss dos 2 jobs agendados).
- `interface/` — as 11 rotas de "Medications" em `endpoints.md`.

## Exposto a `alerts` em M8

`MedicationsWorkerModule.listReminderCandidates` (`index.ts`): tomas `PENDING`/`UNCONFIRMED` com `scheduledAt <= now` (mesmo índice do `mark-unconfirmed`, `dose_occurrences_pending_unconfirmed_idx`) — interface de consulta (`modules.md` §3 nota 3) para o scanner `alerts.scan` decidir `dose.due`/`dose.repeat` sem aceder a `dose_occurrences` diretamente.

## Decisão de change control: `access` expõe `getEffectiveTimezone` (modules.md §2 nota 10)
`modules.md` §2 listava `medications: access, audit` — correto, mas **não bastava**: FR-MED-03/Q8/DM6 exigem conhecer o **fuso efetivo do sujeito** (o do titular com conta; para dependente sem conta, o do tutor principal) para gerar/recalcular qualquer ocorrência. Três hipóteses:
1. `medications` passar a depender de `families`/`users` diretamente — rejeitada: nenhuma das edges criaria um ciclo por si só, mas tornaria `medications` mais acoplado do que o necessário quando já existe um caminho mais curto (ver 2).
2. Resolver o fuso na camada HTTP/composition root e passá-lo como parâmetro simples — rejeitada: a regeneração também acontece em contextos sem HTTP (jobs do worker), duplicando a resolução em cada chamador.
3. **Escolhida:** `access` (que já depende de `families`, modules.md §2) expõe uma função adicional, `getEffectiveTimezone`, implementada em `families` (nova operação crua `getEffectiveTimezone`, mesmo critério de `getBloodType`/`findMemberById`) e passada a direito por `access` — sem decisão de `AccessPolicy.can()` envolvida (não há ação/categoria a autorizar; quem chama já autorizou a operação de negócio). `medications` continua a depender só de `access`+`audit` (modules.md §2 inalterado); zero novas arestas no grafo de módulos, zero risco de ciclo.

Ficheiros tocados por esta decisão: `families/application/get-effective-timezone.ts` (novo), `families/application/ports.ts` (`UserLookup.timezone`), `families/index.ts` (expõe a função), `access/index.ts` (passa-a a direito). Testado indiretamente pelos testes de `medications` (via `FakeTimezone`) — `families`/`access` não ganharam testes próprios adicionais para esta função trivial (passthrough + 1 ramo de fallback a tutor principal), consistente com o nível de teste de `getBloodType`.

## Pendente para revisão do proprietário: gatilho imediato ao mudar fuso/tutor principal
`architecture.md` descreve a regeneração como "diário + imediatamente ao criar/editar plano, **mudar fuso ou tutor principal**". As duas primeiras causas (criar/editar plano) estão implementadas e testadas (regeneração síncrona no próprio pedido). As duas últimas (`users.updateMe` muda o fuso; `families.setPrimaryGuardian` muda o tutor principal) **não têm gatilho imediato**: exigiriam `users`/`families` chamarem `medications`, o que criaria um ciclo (`users`/`families` → `medications` → `access` → `families` → `users`). Resolução adotada nesta tarefa: o job diário `medications.generate-doses` relê o fuso efetivo **a cada corrida**, cobrindo ambos os casos com uma latência limitada à cadência do job (até 24h) — comportamento MVP aceitável ("simple first"), mas diferente de "imediatamente". Alternativas para decisão do proprietário: (a) aceitar a latência de 24h como está; (b) autorizar uma pequena mudança de change control em `users`/`families` para enfileirar um job pg-boss (`medications.recalculate-timezone`) que o worker de `medications` consome — sem import direto, sem ciclo, mas é uma alteração a módulos de M1/M2 já entregues, fora do âmbito desta tarefa sem aprovação explícita.

## Migração
`db/migrations/0007_prescriptions_and_medications.sql`: `medication_plans`, `dose_occurrences` (+ `prescriptions`, ver `prescriptions/README.md`). CHECKs replicados em `domain/medication-plan.ts` (`assertValidSchedule`) para devolver `INVALID_SCHEDULE` com mensagem útil antes de chegar à BD. Índices conforme `indexes.md` (`member_id,status`; `prescription_id`; `status,end_at` parcial; `status,scheduled_at` parcial para o scanner/UNCONFIRMED; `member_id,scheduled_at DESC`).
