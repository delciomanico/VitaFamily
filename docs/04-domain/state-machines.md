# Vita Family — Estados e transições (Fase 10)

> Estado: **v0.9 — secção PROPOSTA "fluxo de processo" (Autorização S4, Despesa/Reembolso S5, alinhamento de Marcação; 2026-11-14, não aprovada, não altera as máquinas em vigor); v0.8 — `ExamOrder` (M15 U, ADR-028); v0.7 — `ConsultationReport` (`DRAFT → FINAL`, M15 S, ADR-027); v0.6 — `ClinicReceipt` (`ISSUED → VOIDED`, M14 R, ADR-026); v0.5 — módulo operacional de seguradoras: `Beneficiary`, `Policy`, `Plan`, `BeneficiaryLinkRequest`, `AuthorizationRequest`, `ExpenseClaim`, `Provider` (ADR-025); v0.4 — `Examination` com marcação direta (nasce `SCHEDULED`), sem `REQUESTED`/`REJECTED` (ADR-023 revisto 2026-11-04); v0.3 introduzira-os; v0.2 acrescentou `ReimbursementClaim` (ADR-021).** Decisões ST1–ST6 adotadas com a recomendação do assistente (delegação do proprietário).
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
`CANCELLED` é final e **bloqueia a confirmação** de ligação do paciente: `confirmLinkRequest` sobre um beneficiário `CANCELLED` ⇒ `409 CONFLICT` (BR-SEG-37). Só `ACTIVE` é elegível (BR-SEG-01).

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

## Propostas — fluxo de processo (PROPOSTO 2026-11-14; `00-product/process-flows.md`)
> **PROPOSTO, não aprovado.** Decisões do proprietário de 2026-11-14 incorporadas abaixo (urgência 48 h com revisão manual; SLA 48 h com escalada ao gestor e sem aprovação tácita; entidade `Process`). Não altera as máquinas acima, que continuam em vigor. Estados do fluxo aprovado em conversa pelo proprietário; o mapeamento para os estados existentes está abaixo e as divergências em `process-flows.md` §11. Dependem de ADR-029/030/031 e dos marcos B/C (`plan.md` §4).

### Marcação — alinhamento (sem nova máquina)
Fluxo proposto: `marcada → confirmada → atendida | cancelada | falta`.
| Proposto | Existente (em vigor) |
|---|---|
| marcada | `Appointment`/`ClinicVisit` `SCHEDULED` com `confirmationStatus=PENDING` |
| confirmada | **atributo** `confirmationStatus=CONFIRMED` (não é estado; BR-CLN-25/26) |
| atendida | `COMPLETED` |
| cancelada | `CANCELLED` (inclui "Não posso", `DECLINED`) |
| falta | `NO_SHOW` |
Notas: `REQUESTED/REJECTED` existem para clínica parceira (D17) e não constam do fluxo proposto (listado como divergência D10). "Confirmada" mantém-se atributo independente.

### Autorização (S4) — proposta
Estados propostos: `pedida → em análise → aprovada | aprovada em parte | recusada | falta informação → usada → expirada`.
```text
pedida → em análise            [sistema, ao submeter; ou → aprovada se auto-aprovação, BR-SEG-03]
pedida → aprovada              [sistema, auto-aprovação (serviço coberto, beneficiário elegível, dentro do teto, sem carência; DECIDIDO Q-A1); reversível, BR-SEG-16; o resto vai para analista]
em análise → aprovada          [analista; define authorizedAmount/validUntil; reserva saldo]
em análise → aprovada em parte [analista; valor/serviços < pedido, motivo]                      ← NOVO
em análise → recusada          [analista, motivo; final; recurso = novo pedido ligado]
em análise → falta informação  [analista, motivo]
falta informação → em análise  [prestador responde]
falta informação → cancelada   [sistema, sem resposta em 7 dias (caduca); novo pedido pode reabrir]   ← NOVO (DECIDIDO 2026-11-14, Q-S1b)
aprovada | aprovada em parte → usada       [sistema, ao aprovar a despesa ligada; reserva → used]
aprovada | aprovada em parte → expirada    [sistema, após validUntil; liberta reserva]
aprovada | aprovada em parte → cancelada   [analista ou prestador, motivo; liberta reserva]  (mantém o existente)
(urgência) sem autorização prévia → pedida [prestador, a posteriori, até 48 h após a admissão (DECIDIDO 2026-11-14, Q-U1); marcada urgência]   ← NOVO (conflita com UC-SEG-10; alteração proposta em process-flows.md §11a)
(urgência) prazo de 48 h falhado → em análise [sistema; flag URGENT_NOTIFY_OVERDUE; revisão manual pela seguradora; NUNCA recusa automática]   ← NOVO
pedida | em análise > 48 h → (mantém estado) [sistema; escala para o SUPERVISOR (SLA_BREACH) e avisa o prestador; NUNCA aprova por silêncio; prazo 48 h por omissão, configurável por seguradora/serviço]   ← NOVO (DECIDIDO 2026-11-14, Q-S1/Q-S1b; papel SUPERVISOR proposto em authorization.md §8.2c)
```
Mapeamento com a máquina existente (`AuthorizationRequest`, ADR-025):
| Proposto | Existente |
|---|---|
| pedida | `SUBMITTED` |
| em análise | `IN_REVIEW` |
| aprovada | `APPROVED` ou `AUTO_APPROVED` (a aprovação decide se se mantém o estado distinto ou vira flag) |
| aprovada em parte | **novo** (hoje `APPROVED` com `authorizedAmount` inferior) |
| recusada | `REJECTED` |
| falta informação | `INFO_REQUESTED` |
| usada / expirada | `USED` / `EXPIRED` |
| (não referida no fluxo) | `CANCELLED` — **mantido** |
Finais: `recusada`, `usada`, `expirada`, `cancelada`. Recurso de uma `recusada` (BR-AUT-08, candidata) cria novo pedido ligado; não reabre o estado; **vários recursos, sem limite fixo (DECIDIDO Q-S2)**, salvaguardas propostas em `process-flows.md` §11a.
Falta (no-show, Q-S3 DECIDIDO): `Appointment` `NO_SHOW` não altera a autorização (continua válida até `validUntil`); a falta fica registada; reagendar no prazo reutiliza a autorização.
A caducidade de `falta informação` (7 dias) usa `CANCELLED` com motivo `INFO_TIMEOUT` (proposta; a confirmar com a aprovação).

### Despesa / reembolso (S5) — proposta
Estados propostos: `submetida → validada → aprovada → paga | contestada`.
```text
submetida → validada        [sistema, se cumpre as regras do plano e sem flags (auto), ou analista]
submetida → em análise      [sistema, por duplicado/valor > autorizado/urgência por regularizar; mantém o existente]
validada → aprovada         [seguradora; reserva → used; atendimento DIRECT_BILLED]
aprovada → paga             [seguradora regista (ao prestador ou, no reembolso, à família); o prestador confirma a receção; o Vita só regista (DECIDIDO 2026-11-14, Q-F1)]
validada | aprovada → contestada [prestador ou família, com motivo; uma vez; reentra em análise]    ← NOVO
(recusada/devolvida)         [mantém `REJECTED` e `RETURNED` existentes; `contestada` aplica-se à decisão negativa]
```
Mapeamento com a máquina existente (`ExpenseClaim`):
| Proposto | Existente |
|---|---|
| submetida | `SUBMITTED` |
| validada | **novo** (resultado da validação automática/`IN_REVIEW` concluída sem exceções) |
| aprovada | `APPROVED` |
| paga | `PENDING_PAYMENT → PAID` (fase 2 hoje) |
| contestada | **novo** (hoje `REJECTED`/`RETURNED`) |
Reembolso fora da rede: hoje `ReimbursementClaim` (`SUBMITTED → APPROVED|REJECTED → PAID`, `PAID` pelo titular, BR-INS-05). **Q-F1 DECIDIDA:** quem regista `PAID` é a seguradora; alteração a BR-INS-05 **proposta, pendente** (`process-flows.md` §11a). **Unificação DECIDIDA 2026-11-14 (Q-F2):** `ReimbursementClaim` passa a `ExpenseClaim` de origem `FAMILY` (mesmos estados e fila única; migração e nova redação de BR-INS-05 **propostas** em ADR-032).

### Process (agregador) — proposta (Q-P1 DECIDIDO 2026-11-14; modelo PROPOSTO em `process-flows.md` §13)
Sem máquina própria: o `family_status` (`AGENDADO → EM_VALIDACAO → A_ATENDER → ATENDIDO → EM_PAGAMENTO → CONCLUIDO | CANCELADO`) é **derivado** dos estados de `Appointment`, `AuthorizationRequest`, `Encounter`, `ExpenseClaim`/`ReimbursementClaim`. Mapeamento exato a escrever após aprovação; as máquinas acima não mudam por causa dele. **Decidido 2026-11-14:** módulo próprio `processes`; todo o ato tem `Process`, com ou sem seguradora (sem seguradora: só marcação/atendimento, `family_status` sem `EM_VALIDACAO`/`EM_PAGAMENTO`); ver ADR-032.

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
