# Vita Family — Estados e transições (Fase 10)

> Estado: **v0.5 — módulo operacional de seguradoras: `Beneficiary`, `Policy`, `Plan`, `BeneficiaryLinkRequest`, `AuthorizationRequest`, `ExpenseClaim`, `Provider` (ADR-025); v0.4 — `Examination` com marcação direta (nasce `SCHEDULED`), sem `REQUESTED`/`REJECTED` (ADR-023 revisto 2026-11-04); v0.3 introduzira-os; v0.2 acrescentou `ReimbursementClaim` (ADR-021).** Decisões ST1–ST6 adotadas com a recomendação do assistente (delegação do proprietário).
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
```
Consulta de clínica parceira nasce REQUESTED; privada/sem clínica nasce SCHEDULED (D17). Consulta passada SCHEDULED permanece SCHEDULED; o sistema envia `APPOINTMENT_OUTCOME_REQUEST` 24 h após a hora (uma vez) (Q4).

## Examination
```text
(início)  → SCHEDULED   [marcação direta num horário EXAM com vaga; ou registo privado futuro]  ← ADR-023 revisto
SCHEDULED → CANCELLED   [conta da clínica, com motivo — só exames da clínica; liberta a vaga] ← D19
SCHEDULED → COMPLETED   [titular/tutor; ou conta da clínica com resultados/PDF — BR-CLN-08]
SCHEDULED → CANCELLED   [titular/tutor; liberta a vaga se tiver slotId]
CANCELLED → SCHEDULED   [titular/tutor — só exames sem slotId; com slotId: pedir novo horário, BR-EXM-08]
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

## ClinicVisit (M14 P, BR-CLN-18)
```text
SCHEDULED → COMPLETED   [conta da clínica, só `outcomeNote`; mesma janela da consulta (ST4)]
SCHEDULED → CANCELLED   [conta da clínica, com motivo; liberta o horário]
```
Nasce `SCHEDULED` (visita presencial só da clínica, paciente sem ligação Vita). Estados finais; sem reagendar (cancelar e marcar outro horário, como BR-APT-09). Não há `REQUESTED`/`NO_SHOW` nesta fase.

## Clinic
```text
ACTIVE → ARCHIVED   [Platform Admin (PARTNER); criador ou Admin da família (PRIVATE)]
ARCHIVED → ACTIVE   [idem]
```
Arquivada: não selecionável em novas marcações; consultas existentes mantêm-na.

## ReimbursementClaim (ADR-021)
```text
SUBMITTED → APPROVED   [portal da seguradora, com motivo opcional]
SUBMITTED → REJECTED   [portal da seguradora, com motivo obrigatório]
APPROVED → PAID        [titular/tutor, confirma receção do pagamento]
```
Nasce `SUBMITTED` ao submeter (`SELF`/`TUTOR_OF`). `APPROVED → PAID` é ação do titular/tutor nesta versão
(não do portal — ver ADR-021, fora do MVP desta funcionalidade marcar `PAID` do lado da seguradora).
Sem transição para fora de `PAID`/`REJECTED` (estados finais).

## Módulo operacional de seguradoras (ADR-025)

### Beneficiary
```text
PENDING → ACTIVE       [BENEFICIARY_MANAGER/INSURANCE_ADMIN, após validação; nunca automático na importação, BR-SEG-17]
ACTIVE → SUSPENDED     [idem, com motivo]
SUSPENDED → ACTIVE     [idem]
ACTIVE|SUSPENDED|PENDING → CANCELLED   [idem, com motivo; final]
```
`CANCELLED` é final. Só `ACTIVE` é elegível (BR-SEG-01).

### Policy (apólice da seguradora)
```text
DRAFT → ACTIVE         [BENEFICIARY_MANAGER/INSURANCE_ADMIN; plano `ACTIVE`]
ACTIVE → SUSPENDED     [idem, com motivo]
SUSPENDED → ACTIVE     [idem]
ACTIVE → EXPIRED       [sistema, após validTo]
DRAFT|ACTIVE|SUSPENDED → CANCELLED   [idem, com motivo]
```
`EXPIRED` e `CANCELLED` são finais.

### Plan
```text
DRAFT → ACTIVE         [INSURANCE_ADMIN]
ACTIVE → ARCHIVED      [INSURANCE_ADMIN; já não aceita apólices novas]
```
Um plano com apólices ativas é imutável: alterar = nova versão em `DRAFT` (estados `Plan` PROPOSTOS, ratificar em S2).

### BeneficiaryLinkRequest (BR-SEG-20)
```text
PENDING → CONFIRMED    [BENEFICIARY_MANAGER/INSURANCE_ADMIN]
PENDING → REJECTED     [idem, com motivo]
CONFIRMED → REVOKED    [paciente (SELF/TUTOR_OF) ou seguradora]
```
Pedido com código inválido/expirado não cria linha (resposta genérica; rate limit).

### AuthorizationRequest
```text
SUBMITTED → AUTO_APPROVED   [sistema, só se todas as condições de BR-SEG-03 forem verdadeiras]
SUBMITTED → IN_REVIEW       [sistema, caso contrário]
IN_REVIEW → APPROVED        [AUTHORIZATION_ANALYST; define authorizedAmount/validUntil; reserva saldo]
IN_REVIEW → REJECTED        [idem, motivo obrigatório; final]
IN_REVIEW → INFO_REQUESTED  [idem, motivo obrigatório]
INFO_REQUESTED → IN_REVIEW  [clínica responde]
APPROVED|AUTO_APPROVED → USED       [sistema, ao aprovar a despesa ligada; reserva → used]
APPROVED|AUTO_APPROVED → EXPIRED    [sistema, após validUntil; liberta reserva]
APPROVED|AUTO_APPROVED → CANCELLED  [AUTHORIZATION_ANALYST (com motivo; reverte auto-aprovação, BR-SEG-16) ou clínica; liberta reserva]
```
Cada decisão é um evento imutável (quem, quando, motivo, estado). `REJECTED`, `USED`, `EXPIRED`, `CANCELLED` são finais.

### ExpenseClaim
```text
SUBMITTED → IN_REVIEW   [CLAIMS_MANAGER abre/assume; ou sistema, por duplicado BR-SEG-11 ou valor > autorizado BR-SEG-13]
IN_REVIEW → APPROVED    [CLAIMS_MANAGER; converte reserva em used; marca o atendimento DIRECT_BILLED]
IN_REVIEW → REJECTED    [idem, motivo obrigatório; final]
IN_REVIEW → RETURNED    [idem, motivo obrigatório, BR-SEG-12]
RETURNED → SUBMITTED    [clínica corrige]
APPROVED → PENDING_PAYMENT → PAID   [fase 2 — fora do MVP; no MVP termina em APPROVED]
```
Duplicados são detetados à submissão e ficam `IN_REVIEW` com flag, nunca rejeitados automaticamente. A clínica só edita em `RETURNED`.

### Provider
```text
ACTIVE ⇄ SUSPENDED      [INSURANCE_ADMIN, com motivo]
```
`SUSPENDED`: a clínica deixa de validar/submeter (`NOT_FOUND`); registos existentes mantêm-se.

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
