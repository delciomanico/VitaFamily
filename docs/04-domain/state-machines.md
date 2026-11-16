# Vita Family — Estados e transições (Fase 10)

> Estado: **v1.3 (R7 do arquivo do marco B, 2026-11-16, ADR-037): retiradas as máquinas de seguradora (`ReimbursementClaim`, Beneficiary, Policy, Plan, link, AuthorizationRequest S4, ExpenseClaim S5, Provider), as «Propostas — fluxo de processo» e a cobertura do `Process`; texto verbatim em `_arquivo/marco-b/extratos/state-machines-seguradora.md`.** O `Process` mantém só a derivação por ato (`deriveFamilyStatus`, 6 linhas).
> Notação: `A → B [quem / condição]`. Transições não listadas são **proibidas** e devolvem `INVALID_STATE_TRANSITION` (409).

## User
```text
PENDING_VERIFICATION → ACTIVE      [verifica e-mail]
ACTIVE → SUSPENDED                 [Platform Admin]
SUSPENDED → ACTIVE                 [Platform Admin]
(qualquer) → eliminado             [próprio, hard delete]
```
PENDING_VERIFICATION não faz login útil: só reenvio de verificação. Token de verificação válido 24 h.

## Invitation
```text
PENDING → ACCEPTED   [convidado, dentro de 7 dias, e-mail coincide]
PENDING → REVOKED    [Admin, ou tutor no caso DEPENDENT_ACCOUNT]
PENDING → EXPIRED    [sistema, após expiresAt]
```
ACCEPTED, REVOKED, EXPIRED são **finais**. Reenviar = novo convite (o anterior é revogado).

## FamilyMember
```text
ACTIVE → BLOCKED     [sistema: menor completa 18 anos sem conta, BR-MEM-11]
BLOCKED → ACTIVE     [pessoa cria conta a partir de convite do Admin]
BLOCKED → eliminado  [sistema: 90 dias sem conta, avisos nos dias 0, 30, 60, 83]
```

## Prescription
```text
ACTIVE → COMPLETED   [titular/tutor, ou sistema quando todos os planos terminam por duração]
ACTIVE → CANCELLED   [titular/tutor]
COMPLETED → ACTIVE   [titular/tutor, reabrir]      ← ST1
CANCELLED → ACTIVE   [titular/tutor, reabrir]      ← ST1
```
Sem estados finais absolutos: o utilizador pode corrigir engano. Reabrir **não** recria tomas passadas; o plano só retoma se for reativado (ver MedicationPlan).

## MedicationPlan
```text
ACTIVE → ENDED       [titular/tutor; sistema ao atingir endAt; receita COMPLETED/CANCELLED]
ENDED → ACTIVE       [titular/tutor: define novo endAt/continuous; só gera tomas futuras]   ← ST1
```

## DoseOccurrence
```text
PENDING → TAKEN          [titular, tutor, dependente com conta]
PENDING → NOT_TAKEN      [idem]
PENDING → UNCONFIRMED    [sistema: scheduledAt + 2 h sem ação]  (Q2)
UNCONFIRMED → TAKEN | NOT_TAKEN   [idem, até ao fim do dia seguinte ao horário]  (Q2)
TAKEN ↔ NOT_TAKEN        [correção por quem agiu, titular ou tutor, até 7 dias]      ← ST2
```
Fora das janelas: `DOSE_WINDOW_EXPIRED`. Confirmar duas vezes o mesmo estado é idempotente. Tomas futuras (scheduledAt > agora + 1 h) não se confirmam (ST3).

## Appointment
```text
REQUESTED → SCHEDULED   [Gestor da clínica confirma]                                ← D17
REQUESTED → REJECTED    [Gestor da clínica recusa, motivo opcional]                  ← D17
REQUESTED → CANCELLED   [titular/tutor desiste; sistema: hora do horário sem resposta] ← D17
SCHEDULED → CANCELLED   [Gestor da clínica, com motivo — só consultas da clínica]     ← D17
SCHEDULED → COMPLETED   [titular/tutor]
SCHEDULED → NO_SHOW     [titular/tutor]
SCHEDULED → CANCELLED   [titular/tutor]
CANCELLED → SCHEDULED   [titular/tutor, reagendar]
COMPLETED ↔ NO_SHOW     [titular/tutor, correção]                                   ← ST4
SCHEDULED → NO_SHOW     [conta da clínica, "Faltou": hora passada e sem `startedAt`]   ← M14 Q, BR-CLN-28
NO_SHOW → SCHEDULED     [conta da clínica, "Chegou" no dia da marcação (chegada tardia)] ← M14 Q
SCHEDULED → CANCELLED   [titular/tutor, "Não posso": `confirmationStatus=DECLINED`, liberta o horário] ← M14 Q, BR-CLN-26
```
Consulta de clínica parceira nasce REQUESTED; privada/sem clínica nasce SCHEDULED (D17). Consulta passada SCHEDULED permanece SCHEDULED; o sistema envia `APPOINTMENT_OUTCOME_REQUEST` 24 h após a hora (uma vez) (Q4).

### Confirmação e fluxo do dia (M14 Q — BR-CLN-25/26/28; consulta e `ClinicVisit`)
**Confirmação** (`confirmationStatus`, independente do estado; só enquanto a marcação é `SCHEDULED` e futura):
```text
PENDING   → CONFIRMED   [paciente "Vou" na app (consulta Vita); ou conta da clínica "confirmado por telefone" (consulta ou visita)]
CONFIRMED → DECLINED    [paciente "Não posso": a consulta passa a CANCELLED na mesma transação; só consulta Vita]
PENDING   → DECLINED    [idem]
DECLINED  → (final)     [GOING depois de CANNOT ⇒ INVALID_STATE_TRANSITION; pedir novo horário]
```
**Dia** (`dayState`, **derivado**, sem coluna): `SCHEDULED` (sem `arrivedAt`) → `ARRIVED` (`arrivedAt` definido, **Chegou**) → `IN_PROGRESS` (`startedAt` definido, **Iniciar**) → `COMPLETED` (**Concluir**, `…/complete`, fluxo existente) | `NO_SHOW` (**Faltou**, só `SCHEDULED` com hora passada e sem `startedAt`). `Iniciar` pode saltar `Chegou` (define ambos). `Chegou` repete-se sem efeito; a partir de `NO_SHOW` repõe `SCHEDULED` com `arrivedAt`. `ARRIVED`/`IN_PROGRESS` **não** são valores de `appointment_status` nem de `clinic_visit_status`: o ciclo de vida Vita (e a app) não muda. Check-in e iniciar só no dia local da marcação (`CLINIC_TIMEZONE`).

## Examination
```text
(início)  → SCHEDULED   [marcação direta num horário EXAM com vaga; ou registo privado futuro]  ← ADR-023 revisto
SCHEDULED → CANCELLED   [conta da clínica, com motivo — só exames da clínica; liberta a vaga] ← D19
SCHEDULED → COMPLETED   [titular/tutor; ou conta da clínica com resultados/PDF — BR-CLN-08]
SCHEDULED → CANCELLED   [titular/tutor; liberta a vaga se tiver slotId]
CANCELLED → SCHEDULED   [titular/tutor — só exames sem slotId; com slotId: pedir novo horário, BR-EXM-08]
```
M15 U (ADR-028): um exame ligado a um `ExamOrder` (`examOrderId`) propaga `COMPLETED` (pedido `FULFILLED`) e `CANCELLED`/apagado (pedido de novo `ORDERED`); `CANCELLED → SCHEDULED` pela família **não religa** o pedido (fica `ORDERED`; o paciente volta a marcar com o pedido). O rótulo "Com pedido" na agenda de exames da clínica fica fora desta entrega (OP-57).
```
Exame de clínica parceira (`slotId`) **nasce SCHEDULED** se o horário tem vaga (BR-EXM-05, BR-APT-11); privado/sem clínica nasce SCHEDULED ou COMPLETED (data passada) como antes. **`REQUESTED` e `REJECTED` foram retirados do fluxo** (ADR-023 revisto): os valores permanecem no enum de BD `exam_status` **apenas por compatibilidade** (PostgreSQL não remove valores de enum sem recriar o tipo), são proibidos por CHECK em `examinations` (migração 0022), nunca são produzidos pela aplicação nem expostos na API (`Examination.status` ∈ SCHEDULED|COMPLETED|CANCELLED).
Exame criado com `examDate` passada nasce COMPLETED; resultados só se adicionam a exames COMPLETED — **exceção atómica:** a clínica completa (`SCHEDULED → COMPLETED`) e grava os resultados na mesma transação (BR-CLN-08).   ← ST5, D19
Lembretes (24 h) só em SCHEDULED (BR-EXM-06). Vaga ocupada ⇔ `SCHEDULED` com `slotId`; `CANCELLED` (por quem for) liberta-a. Não há expiração por falta de resposta (BR-EXM-07 obsoleta).

## Recommendation
Sem máquina de estados: criada, imutável pela clínica, eliminada em cascata com a origem (BR-CLN-09).

## Document (scanStatus)
```text
PENDING → CLEAN       [antivírus]
PENDING → INFECTED    [antivírus] → ficheiro apagado, registo eliminado, upload auditado
```
Documento PENDING não pode ser descarregado (`DOCUMENT_NOT_AVAILABLE`).

## ClinicVisit (M14 P, BR-CLN-18; `NO_SHOW` em M14 Q)
```text
SCHEDULED → COMPLETED   [conta da clínica, só `outcomeNote`; mesma janela da consulta (ST4)]
SCHEDULED → CANCELLED   [conta da clínica, com motivo; liberta o horário]
SCHEDULED → NO_SHOW     [conta da clínica, "Faltou": hora passada e sem `startedAt`; M14 Q]
NO_SHOW   → SCHEDULED   [conta da clínica, "Chegou" no dia da marcação; M14 Q]
```
Nasce `SCHEDULED` (visita presencial só da clínica, paciente sem ligação Vita). Estados finais; sem reagendar (cancelar e marcar outro horário, como BR-APT-09). Não há `REQUESTED`. Desde M14 Q há `NO_SHOW` (reversível pela chegada tardia); `COMPLETED` e `CANCELLED` são finais.

## ClinicReceipt (M14 R, BR-CLN-31..33)
```text
(novo)  → ISSUED   [conta da clínica (Admin/Gestor), sobre uma marcação COMPLETED da própria clínica; atribui o número seguinte]
ISSUED  → VOIDED   [conta da clínica (Admin/Gestor), com motivo 3–200; irreversível]
```
`VOIDED` é final (corrigir = anular e emitir novo, com **novo** número; o número anulado nunca se reutiliza). Um só `ISSUED` por marcação. Sem editar nem apagar. O estado do recibo não altera o da marcação nem o de um `ReimbursementClaim` já submetido (o revisor vê `VOIDED`).

## ConsultationReport (M15 S, BR-CLN-41..43)
```text
(novo)  → DRAFT   [CLINIC_DOCTOR, marcação SCHEDULED ou COMPLETED sem FINAL; guarda/atualiza o texto]
DRAFT   → DRAFT   [CLINIC_DOCTOR, nova gravação; última escrita ganha]
DRAFT   → FINAL   [CLINIC_DOCTOR: PUT …/report/finalize, ou PUT …/complete com `report`, atómico com SCHEDULED → COMPLETED]
FINAL   → FINAL   [finalize repetido: idempotente, sem efeito]
FINAL   + adenda  [CLINIC_DOCTOR, até 20; o texto final não muda]
```
`FINAL` é final e imutável (trigger de BD). Não há `FINAL → DRAFT` nem apagar. A marcação ligada não influencia o relatório depois de `FINAL` (correção `COMPLETED ↔ NO_SHOW` do titular não o altera); um `DRAFT` de marcação que deixou de ser `SCHEDULED`/`COMPLETED` já não se edita. Resultados do exame: o **rascunho** (`ExamResultsDraft`) não é um estado do `Examination` — o exame continua `SCHEDULED` até `complete` (ST5); o laudo só nasce com `SCHEDULED → COMPLETED` (BR-CLN-48).

## Clinic
```text
ACTIVE → ARCHIVED   [Platform Admin (PARTNER); criador ou Admin da família (PRIVATE)]
ARCHIVED → ACTIVE   [idem]
```
Arquivada: não selecionável em novas marcações; consultas existentes mantêm-na.

## ExamOrder (M15 U, BR-CLN-51..52)
```text
(novo)    → ORDERED    [CLINIC_DOCTOR, marcação SCHEDULED ou COMPLETED; 1–5 por pedido, ≤5 ativos por marcação]
ORDERED   → SCHEDULED  [titular/tutor marca exame com examOrderId (exame SCHEDULED, qualquer clínica)]
ORDERED   → FULFILLED  [idem, exame que nasce COMPLETED (data passada)]
SCHEDULED → FULFILLED  [exame ligado passa a COMPLETED (titular/tutor ou clínica)]
SCHEDULED → ORDERED    [exame ligado cancelado ou apagado: ligação desfeita]
FULFILLED → ORDERED    [exame ligado apagado: ligação desfeita]
ORDERED | SCHEDULED → CANCELLED [CLINIC_DOCTOR, como a clínica vê o estado; não toca no Examination]
CANCELLED → (final)    [Admin/Gestor nunca cancelam; FULFILLED visível à clínica ⇒ INVALID_STATE_TRANSITION]
```
Os movimentos fazem-se pela porta `ExamOrderLinker` na mesma transação do `Examination`. **Visão da clínica:** `SCHEDULED`/`FULFILLED` só se `bookedHere=true`; senão mostra `ORDERED`. A **declaração de presença** (M15 V) não é entidade: exige marcação `COMPLETED` ou `SCHEDULED` com `arrivedAt` (dia derivado `ARRIVED`/`IN_PROGRESS`/`COMPLETED`, M14 Q).
## Process — mapeamento vigente (contrato 2026-11-14; BR-PRC-02/03/04; arquivo do marco B, ADR-037: sem cobertura)
**Sem máquina própria e sem estado persistido.** O `family_status` é calculado em leitura por `deriveFamilyStatus(facts)` (função pura de `processes/domain`, sem relógio nem I/O) a partir do facto do ato (`ActFact`) que o módulo dono publica pela porta `ProcessFacts`. Fatias futuras podem acrescentar factos e linhas a esta tabela; as máquinas dos módulos donos **não mudam**.

**1) Projeção do estado do ato → `phase`** (função pura em cada módulo dono, testada; TC-PRC-08/09)
| Módulo | Estado do ato | `phase` |
|---|---|---|
| `appointments` | `REQUESTED` | `PENDING` |
| `appointments` | `SCHEDULED` e (`arrived_at` ou `started_at` não nulo) | `IN_PROGRESS` |
| `appointments` | `SCHEDULED` (sem chegada/início) | `SCHEDULED` |
| `appointments` | `COMPLETED` | `DONE` |
| `appointments` | `NO_SHOW` | `NO_SHOW` |
| `appointments` | `CANCELLED`, `REJECTED` | `CANCELLED` |
| `examinations` | `SCHEDULED` | `SCHEDULED` |
| `examinations` | `COMPLETED` | `DONE` |
| `examinations` | `CANCELLED` | `CANCELLED` |
| `examinations` | `REQUESTED`, `REJECTED` (obsoletos, ADR-023) | erro de integridade (nunca ocorre; CHECK da BD) |
`changedAt` = `updated_at` da linha do ato; `scheduledAt` = `scheduled_at` do ato (nulo num exame sem horário).

**2) Tabela de verdade de `deriveFamilyStatus` (fatia 1, 6 linhas, totalidade verificada)**
| `phase` | `familyStatus` | `nextStep.code` | `nextStep.actor` |
|---|---|---|---|
| `PENDING` | `SCHEDULED` | `AWAIT_CLINIC_RESPONSE` | `CLINIC` |
| `SCHEDULED` | `SCHEDULED` | `ATTEND` | `FAMILY` |
| `IN_PROGRESS` | `IN_PROGRESS` | `BEING_ATTENDED` | `CLINIC` |
| `DONE` | `DONE` | `NOTHING_PENDING` | `NONE` |
| `CANCELLED` | `CANCELLED` | `NOTHING_PENDING` | `NONE` |
| `NO_SHOW` | `CANCELLED` | `RESCHEDULE` | `FAMILY` |
Decisão por defeito: a falta (`NO_SHOW`) aparece à família como "Cancelado" com o passo "voltar a marcar" . Alterar é change control (muda só esta linha e TC-PRC-06).


## Professional — validação (MK1, BR-MKT-15..21; contrato 2026-11-16)
```text
DRAFT          → PENDING_REVIEW   [profissional submete; requisitos BR-MKT-16 cumpridos]            (ValidationCase SUBMITTED)
NEEDS_INFO     → PENDING_REVIEW   [profissional volta a submeter]                                   (SUBMITTED)
PENDING_REVIEW → APPROVED         [admin APPROVE; BR-MKT-16 cumprido]                               (APPROVED; gera horários)
PENDING_REVIEW → REJECTED         [admin REJECT; motivo obrigatório]                                (REJECTED)
PENDING_REVIEW → NEEDS_INFO       [admin REQUEST_INFO; motivo obrigatório]                          (NEEDS_INFO)
APPROVED       → NEEDS_INFO       [admin REQUEST_INFO (reabertura/mudança de identidade)  |  sistema: credencial caducada]  (NEEDS_INFO | EXPIRED)
REJECTED       → NEEDS_INFO       [admin REQUEST_INFO (reabertura; OP-60)]                          (NEEDS_INFO)
APPROVED       → SUSPENDED        [admin SUSPEND; motivo obrigatório]                               (SUSPENDED)
SUSPENDED      → APPROVED         [admin REACTIVATE; BR-MKT-16 cumprido]                            (REACTIVATED)
```
Tabela de decisões do admin (única via de decisão; o profissional só submete; o sistema só caduca):

| Decisão | De | Para | `reason` |
|---|---|---|---|
| `APPROVE` | PENDING_REVIEW | APPROVED | opcional |
| `REJECT` | PENDING_REVIEW | REJECTED | obrigatório |
| `REQUEST_INFO` | PENDING_REVIEW, APPROVED, REJECTED | NEEDS_INFO | obrigatório |
| `SUSPEND` | APPROVED | SUSPENDED | obrigatório |
| `REACTIVATE` | SUSPENDED | APPROVED | opcional |

Transições não listadas (p. ex. `DRAFT → APPROVED`, `SUSPENDED → NEEDS_INFO`, `REJECTED → APPROVED`, `APPROVED → PENDING_REVIEW` pelo profissional) ⇒ `INVALID_STATE_TRANSITION`. Cada transição escreve um `ValidationCase` na mesma transação, com bloqueio da linha do profissional (decisões concorrentes: a segunda falha). **Visibilidade:** só `APPROVED` (BR-MKT-19). **Escrita pelo profissional** por estado: `authorization.md` §10.2.

## ProfessionalCredential (scanStatus; BR-MKT-17)
```text
PENDING → CLEAN       [antivírus]
PENDING → INFECTED    [antivírus] → objeto apagado (outbox próprio `professional_file_deletions`); a linha fica «INFECTED» para o profissional a ver e remover; conta como em falta
```
Difere de `Document` (que elimina a linha) só para o profissional perceber o que falhou. `PENDING`/`INFECTED` não se descarregam (`DOCUMENT_NOT_AVAILABLE`) nem satisfazem os requisitos de submissão.

## Alert / Notification
```text
Alert: não lido → lido [destinatário]  (campo readAt; não há estados de máquina)
Notification: PENDING → SENT | FAILED | SKIPPED
              FAILED → PENDING [retry, máx. 5 tentativas com backoff 1, 5, 15, 60, 240 min]  ← ST6
```
SKIPPED: canal desativado, sem subscrição push, conta suspensa ou alerta lido antes do envio.

## DataExport
```text
PENDING → READY → EXPIRED   [READY válido 7 dias]
PENDING → FAILED            [retry manual: novo pedido]
```

## Decisões de estados (adotadas)
| ID | Decisão | Escolha |
|---|---|---|
| ST1 | Receitas e planos terminados podem reabrir? | **Sim**, para corrigir enganos (sem recriar passado). |
| ST2 | Janela de correção de uma toma | **7 dias**. |
| ST3 | Confirmar tomas futuras | **Não** (só até 1 h antes do horário). |
| ST4 | COMPLETED/NO_SHOW corrigíveis entre si | **Sim**. |
| ST5 | Resultados só em exames COMPLETED | **Sim** (exceção: completar pela clínica grava-os atomicamente, ADR-023). |
| ST6 | Retry de notificações | **5 tentativas** com backoff crescente. |
