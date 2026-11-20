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

**1b) MK3 — projeção de `bookings` (`source=BOOKING`; função pura de `consultations/domain`, TC-MKT-88)**
| Módulo | Estado da marcação | `phase` |
|---|---|---|
| `consultations` | `REQUESTED` | `PENDING` |
| `consultations` | `CONFIRMED` | `SCHEDULED` |
| `consultations` | `COMPLETED` | `DONE` |
| `consultations` | `NO_SHOW` | `NO_SHOW` |
| `consultations` | `CANCELLED`, `REJECTED` | `CANCELLED` |
O `ActFact` de `BOOKING` leva ainda um **`hint?`** de lista fechada (`PAYMENT_PROOF_DUE` · `PAYMENT_UNDER_REVIEW` · `PAYMENT_DISPUTED` · `REVIEW_DUE`), também calculado por `consultations` (`CONFIRMED`/`COMPLETED` com `paymentStatus` `AWAITING_PROOF`/`REJECTED` ⇒ `PAYMENT_PROOF_DUE`; `PROOF_SUBMITTED` ⇒ `PAYMENT_UNDER_REVIEW`; `DISPUTED` ⇒ `PAYMENT_DISPUTED`; `COMPLETED` com pagamento satisfeito, janela de 30 dias aberta e sem avaliação ⇒ `REVIEW_DUE`; senão nulo). `changedAt` = `updated_at` da marcação; `scheduledAt` = `startsAt`. O `hint` é aditivo e opcional: os atos `APPOINTMENT`/`EXAMINATION` nunca o têm.

**2b) Tabela de verdade de `deriveFamilyStatus` — linhas acrescentadas por MK3 (só `source=BOOKING`; as 6 linhas de cima mantêm-se para os restantes)**
| `phase` | `hint` | `familyStatus` | `nextStep.code` | `nextStep.actor` |
|---|---|---|---|---|
| `PENDING` | — | `SCHEDULED` | `AWAIT_PROFESSIONAL_RESPONSE` | `PROFESSIONAL` |
| `SCHEDULED` | — | `SCHEDULED` | `ATTEND` | `FAMILY` |
| `SCHEDULED` | `PAYMENT_PROOF_DUE` | `SCHEDULED` | `SEND_PAYMENT_PROOF` | `FAMILY` |
| `SCHEDULED` | `PAYMENT_UNDER_REVIEW` | `SCHEDULED` | `AWAIT_PAYMENT_CONFIRMATION` | `PROFESSIONAL` |
| `SCHEDULED` | `PAYMENT_DISPUTED` | `SCHEDULED` | `AWAIT_PAYMENT_DISPUTE_DECISION` | `PLATFORM` |
| `DONE` | — | `DONE` | `NOTHING_PENDING` | `NONE` |
| `DONE` | `PAYMENT_PROOF_DUE` | `DONE` | `SEND_PAYMENT_PROOF` | `FAMILY` |
| `DONE` | `PAYMENT_UNDER_REVIEW` | `DONE` | `AWAIT_PAYMENT_CONFIRMATION` | `PROFESSIONAL` |
| `DONE` | `PAYMENT_DISPUTED` | `DONE` | `AWAIT_PAYMENT_DISPUTE_DECISION` | `PLATFORM` |
| `DONE` | `REVIEW_DUE` | `DONE` | `LEAVE_REVIEW` | `FAMILY` |
| `CANCELLED` | — | `CANCELLED` | `NOTHING_PENDING` | `NONE` |
| `NO_SHOW` | — | `CANCELLED` | `RESCHEDULE` | `FAMILY` |
Combinações não listadas (p. ex. `hint` com `PENDING`/`CANCELLED`) são **ignoradas** (tratam-se como `hint` nulo; a função é total). `IN_PROGRESS` não existe para marcações (sem chegada/início). Os conjuntos `nextStep.code`/`actor` continuam **abertos** (BR-PRC-03): os valores novos são `AWAIT_PROFESSIONAL_RESPONSE`, `SEND_PAYMENT_PROOF`, `AWAIT_PAYMENT_CONFIRMATION`, `AWAIT_PAYMENT_DISPUTE_DECISION`, `LEAVE_REVIEW` e os atores `PROFESSIONAL`, `PLATFORM`. A leitura de um `Process` `BOOKING` exige READ(APPOINTMENTS) (BR-MKT-55).

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

## Conversation (MK2, BR-MKT-43/44/47; contrato 2026-11-17)
```text
(nova)  → OPEN                       [família abre com a 1.ª mensagem; profissional APPROVED]        (1 conversa por membro-sujeito e profissional)
OPEN    → CLOSED (closedBy=FAMILY)       [família fecha]
OPEN    → CLOSED (closedBy=PROFESSIONAL) [profissional fecha, p. ex. para travar abuso]
OPEN    → CLOSED (closedBy=SYSTEM)       [admin decide HIDE_AND_CLOSE numa denúncia]
CLOSED(FAMILY)       → OPEN  [só a família reabre]
CLOSED(PROFESSIONAL) → OPEN  [só o profissional reabre]
CLOSED(SYSTEM)       → (sem transição em MK2)
```
`status` e `closedBy` mudam **só** por estas transições (cada uma auditada, transação com bloqueio da linha da conversa); uma transição inválida (fechar fechada, reabrir aberta ou por quem não fechou) ⇒ `INVALID_STATE_TRANSITION`; abrir/continuar ou enviar numa conversa fechada ⇒ `CONVERSATION_CLOSED`. **Efeito derivado, sem transição:** se o profissional deixa de estar `APPROVED` (suspensão, caducidade, rejeição) a conversa continua `OPEN`/`CLOSED` mas `canSend = false` e ninguém envia (`CONVERSATION_CLOSED` à família, `PROFESSIONAL_LOCKED` ao profissional); ao reativar, retoma (BR-MKT-47). A conversa desaparece só por retenção (24 meses desde `lastMessageAt`), apagamento do membro/família ou do profissional (cascata).

## MessageReport (MK2, BR-MKT-44)
```text
(nova) → OPEN                [participante denuncia uma mensagem do outro lado]
OPEN   → DECIDED(DISMISS)       [admin arquiva; a mensagem fica visível]
OPEN   → DECIDED(HIDE_MESSAGE)  [admin oculta: messages.hidden_at definido]
OPEN   → DECIDED(HIDE_AND_CLOSE)[admin oculta e fecha a conversa (SYSTEM)]
```
Decisões concorrentes: bloqueio da denúncia; a segunda ⇒ `INVALID_STATE_TRANSITION`. A decisão é definitiva (sem reabertura em MK2).

## Message (MK2) — imutável
Não tem máquina de estados: `body` e `seq` nunca mudam; o único efeito é `hiddenAt` (nulo → data, por moderação, irreversível em MK2).

## Booking — marcação (MK3, BR-MKT-51..55; contrato 2026-11-19)
```text
(nova)    → REQUESTED   [família marca; horário reservado; Process BOOKING aberto]
REQUESTED → CONFIRMED   [profissional APPROVED confirma; cria a consulta no membro]
REQUESTED → REJECTED    [profissional recusa; motivo obrigatório; horário libertado]
REQUESTED → CANCELLED   [família (antes da hora) | profissional (antes da hora, motivo) | sistema (48 h sem resposta ou hora passada)]
CONFIRMED → COMPLETED   [profissional, com agora ≥ startsAt; grava completedAt]
CONFIRMED → NO_SHOW     [profissional, com agora ≥ startsAt]
CONFIRMED → CANCELLED   [família | profissional (antes da hora) | sistema: profissional deixou de estar APPROVED]
REJECTED | CANCELLED | COMPLETED | NO_SHOW → (terminais; sem correção em MK3, OP-108)
```
Cada transição corre numa transação com `SELECT … FOR UPDATE` da marcação; a corrida (duas decisões) ⇒ a segunda recebe `INVALID_STATE_TRANSITION`. **Efeitos na mesma transação:** `REJECTED`/`CANCELLED` libertam o horário (`slot.booking_id`, `bookings.slot_id` → nulo); `CONFIRMED` cria a consulta no membro (`FamilyAppointmentWriter`); `COMPLETED`/`NO_SHOW`/`CANCELLED` atualizam a consulta (se existir); toda a transição atualiza o `ActFact` (lido por pedido, BR-PRC modelo *pull*) e gera o aviso (BR-MKT-65). Quem pode cada transição e em que estado do profissional: `authorization.md` §12. **Derivado, sem transição:** um profissional que deixa de estar `APPROVED` não confirma, recusa, conclui nem decide comprovativos (`PROFESSIONAL_LOCKED`); o job `consultations.reconcile-bookings` cancela depois as futuras (BR-MKT-54).

## PaymentStatus da marcação e PaymentProof (MK3, BR-MKT-56..58)
```text
Marcação com preço 0 Kz                      → NOT_REQUIRED (fixo)
Marcação com preço > 0                       → AWAITING_PROOF (à criação)
AWAITING_PROOF | REJECTED → PROOF_SUBMITTED  [família carrega um comprovativo; marcação CONFIRMED ou COMPLETED]
PROOF_SUBMITTED → CONFIRMED                  [profissional CONFIRM]
PROOF_SUBMITTED → REJECTED                   [profissional REJECT; motivo obrigatório]
REJECTED        → DISPUTED                   [família disputa o comprovativo rejeitado (uma vez por comprovativo)]
DISPUTED        → CONFIRMED                  [admin CONFIRM_PAYMENT]
DISPUTED        → REJECTED                   [admin UPHOLD_REJECTION; o comprovativo fica REJECTION_UPHELD]
CONFIRMED       → (terminal)
```
`PaymentProof.status`: `SUBMITTED → CONFIRMED | REJECTED`; `REJECTED → DISPUTED`; `DISPUTED → CONFIRMED | REJECTION_UPHELD`. Um só comprovativo em curso (`SUBMITTED`/`DISPUTED`) por marcação; máx. 5. O estado do pagamento **congela** com a marcação `CANCELLED`/`REJECTED`/`NO_SHOW`. **Comprovativo infetado (OP-114):** o antivírus apaga a linha (não há estado `INFECTED` em `PaymentProof.status`) e `paymentStatus` volta a `AWAITING_PROOF` (ou `REJECTED` se já houve rejeição); sem aviso à família. **Marcação cancelada com uma disputa aberta (OP-114):** o comprovativo permanece `DISPUTED` mas sai da fila do admin (sem transição). Não existe `PAID` nem transição por silêncio/tempo.

## Review e ReviewReport (MK3, BR-MKT-59/60)
```text
Review: (nova) → criada [marcação COMPLETED + pagamento CONFIRMED|NOT_REQUIRED, ≤ 30 dias após completedAt]
        criada → editada [família, ≤ 7 dias após a criação; rating e comment]
        sem resposta → com resposta [profissional, uma vez; sem edição]
        comentário visível → oculto (commentHiddenAt) [admin HIDE_COMMENT; irreversível em MK3; a nota continua a contar]
ReviewReport: (nova) → OPEN [profissional denuncia; uma por avaliação]
              OPEN → DECIDED(DISMISS)       [admin arquiva]
              OPEN → DECIDED(HIDE_COMMENT)  [admin oculta o comentário]
```
Decisões concorrentes: bloqueio da denúncia; a segunda ⇒ `INVALID_STATE_TRANSITION`. A decisão é definitiva em MK3.

## RecordShare — partilha de registos (MK4, BR-MKT-69..74; contrato 2026-11-20)
```text
(nova)  → ACTIVE     [família SELF/TUTOR_OF cria sobre uma marcação CONFIRMED|COMPLETED; expiresAt calculado e imutável]
ACTIVE  → REVOKED    [família SELF/TUTOR_OF revoga; efeito imediato; irreversível]
ACTIVE  → CONSUMED   [só viewOnce: primeira abertura bem-sucedida do profissional, na mesma transação da leitura]
ACTIVE  → EXPIRED    [DERIVADO: expiresAt ≤ agora; não é gravado nem há job]
REVOKED | CONSUMED | EXPIRED → (terminais; sem reativar nem prolongar: cria-se outra partilha)
```
**Estado efetivo de abertura (por pedido, BR-MKT-70):** só se abre quando `status=ACTIVE` **e** `expiresAt > agora` **e** o profissional está `APPROVED` **e** a marcação âncora está `CONFIRMED`/`COMPLETED` **e** o membro `ACTIVE`; qualquer falha ⇒ `SHARE_NOT_AVAILABLE` (`CONSUMED` ⇒ `SHARE_ALREADY_VIEWED`). Marcação cancelada, profissional suspenso ou membro bloqueado **não** alteram a linha: tornam-na inaberta enquanto durar a condição (reativado o profissional, volta a abrir-se dentro do prazo). **Efeitos:** `CONSUMED` e cada abertura bem-sucedida gravam uma `RecordShareView` na mesma transação; revogar não apaga vistas. Revogar uma partilha já terminada ⇒ `INVALID_STATE_TRANSITION`. A transição `ACTIVE → REVOKED|CONSUMED` faz-se por `UPDATE … WHERE status='ACTIVE'` condicional (`SELECT … FOR UPDATE` na revogação), pelo que de duas decisões concorrentes só uma vence.

## Receita digital — elegibilidade da emissão (MK4, BR-MKT-79..80; sem estados novos)
```text
canPrescribe = DIGITAL_PRESCRIPTION_ENABLED
             ∧ profissional APPROVED (credencial válida implícita, BR-MKT-21)
             ∧ marcação do profissional ∧ status = COMPLETED   (qualquer método, OP-126)
             ∧ categoria da especialidade marcada = HEALTH
             ∧ agora ≤ completedAt + 7 dias
             ∧ ainda não existe Prescription com booking_id = marcação
```
Função **pura** de `consultations/domain` (flag, estado, categoria, `completedAt`, existência) com testes de tabela; a emissão repete-a **sob bloqueio da marcação**. `Prescription.status` não muda (ACTIVE | COMPLETED | CANCELLED); a origem `PROFESSIONAL` é imutável e o conteúdo da receita é só leitura para a família (OP-127; cancelar/concluir/reabrir e apagar continuam permitidos pelas transições de ST1).

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
