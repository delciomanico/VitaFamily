# Vita Family — Estados e transições (Fase 10)

> Estado: **v1.1 (2026-11-15, marco B fatia 4, ADR-035): S4 ganha `AUTO_APPROVE`, `REOPEN` e `REVERT_APPROVAL` por analista/supervisor, `closedReason=ANALYST_CANCELLED`, SLA como marca `escalated_at` e `coverage-phase` com relógio (sem estados novos);** v1.0 (2026-11-14, marco B fatia 3, ADR-034): `AuthorizationRequest` passa a S4 simplificado VIGENTE (6 estados, sem `AUTO_APPROVED`/`USED`/`EXPIRED`; `closedReason`; recurso = novo pedido ligado) e `deriveFamilyStatus` ganha o facto de cobertura (§Process, tabela 3);** v0.9 — secção PROPOSTA "fluxo de processo" (Autorização S4, Despesa/Reembolso S5, alinhamento de Marcação; 2026-11-14, não aprovada, não altera as máquinas em vigor); v0.8 — `ExamOrder` (M15 U, ADR-028); v0.7 — `ConsultationReport` (`DRAFT → FINAL`, M15 S, ADR-027); v0.6 — `ClinicReceipt` (`ISSUED → VOIDED`, M14 R, ADR-026); v0.5 — módulo operacional de seguradoras: `Beneficiary`, `Policy`, `Plan`, `BeneficiaryLinkRequest`, `AuthorizationRequest`, `ExpenseClaim`, `Provider` (ADR-025); v0.4 — `Examination` com marcação direta (nasce `SCHEDULED`), sem `REQUESTED`/`REJECTED` (ADR-023 revisto 2026-11-04); v0.3 introduzira-os; v0.2 acrescentou `ReimbursementClaim` (ADR-021).** Decisões ST1–ST6 adotadas com a recomendação do assistente (delegação do proprietário).
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

### AuthorizationRequest — S4 simplificado, VIGENTE para o marco B (fatias 3 e 4; ADR-034, ADR-035; `marco-b-construcao.md` §6)
> **Substitui** a máquina de 9 estados de ADR-025 (`AUTO_APPROVED`, `USED`, `EXPIRED`, aprovada em parte e SLA deixam de ser estados). Uma só máquina por entidade, **centralizada num ficheiro** (`insurer-ops/domain/authorization-machine.ts`: tabela de transições com ator e guarda; os testes percorrem todas as transições legais e rejeitam as ilegais, TC-AUT-01). Todo o estado muda por transição nomeada; cada transição grava um `AuthorizationEvent` e a auditoria correspondente.
```text
(criação)         → SUBMITTED   [clínica; fatia 3]
SUBMITTED → IN_REVIEW           [sistema, na mesma transação da criação, quando a auto-aprovação não se aplica (ou é recurso)]
SUBMITTED → APPROVED            [sistema, AUTO_APPROVE, só na criação de um pedido que não é recurso e cujo podeAutoAprovar é ok (BR-AUT-03); decidedBy = SYSTEM; authorizedAmount = requestedAmount; gera code e validUntil]
IN_REVIEW → APPROVED            [AUTHORIZATION_ANALYST em pedidos normais; SUPERVISOR só em recursos; define authorizedAmount/validUntil/code; "em parte" = authorizedAmount < requestedAmount, derivado; decidedBy = ANALYST|SUPERVISOR]
IN_REVIEW → REJECTED            [mesmos atores, motivo obrigatório (visível à clínica); final para a clínica; recurso = NOVO pedido ligado]
IN_REVIEW → INFO_REQUESTED      [mesmos atores, motivo obrigatório; define infoExpiresAt]
INFO_REQUESTED → IN_REVIEW      [clínica responde (message); recalcula decisionDueAt; fatia 3]
INFO_REQUESTED → CANCELLED      [sistema, sem resposta até infoExpiresAt: closedReason = INFO_TIMEOUT; job insurer.expire-info-requests; fatia 3]
SUBMITTED|IN_REVIEW|INFO_REQUESTED → CANCELLED  [clínica, closedReason = CLINIC_CANCELLED; fatia 3]
APPROVED → CANCELLED            [REVERT_APPROVAL, closedReason = ANALYST_CANCELLED, motivo obrigatório (visível à clínica): analista só se decidedBy = ANALYST; SUPERVISOR qualquer (única via para decidedBy = SYSTEM; BR-SEG-16); a clínica NÃO cancela uma APPROVED (sem reserva de saldo, ADR-035 §7)]
REJECTED → IN_REVIEW            [REOPEN, SUPERVISOR, motivo interno; só até appealOpenUntil, sem recurso não cancelado e sem duplicado em curso; limpa decisão, atribuição e escalated_at; quem recusou não volta a decidi-lo (BR-AUT-22)]
```
**Finais:** `CANCELLED`; `REJECTED` é final **para a clínica** (só o `SUPERVISOR` o reabre). `APPROVED` não é final (pode ser revertida). «Usada» e «expirada» são **derivadas** (`expired` = `validUntil` passada; `USED` na 2b), nunca estados nem jobs de transição. **Nunca aprova por silêncio** (Q-V2 A): o atraso só gera a **marca** `escalated_at` (BR-AUT-20), não transição. A atribuição a um analista (`assigned_to`) também é marca, não estado.
**Recurso (BR-AUT-08):** de um `REJECTED`, até `APPEAL_REQUEST_DAYS` (15) após `decidedAt`, **cria-se um novo pedido** (`parentRequestId`, mesmo beneficiário/serviço/guia/processo) que nasce `SUBMITTED → IN_REVIEW` (**nunca** auto-aprovado) com prazo `APPEAL_RESPONSE_HOURS`; o pedido recusado **não muda de estado**; no máximo um recurso não cancelado por recusa; cadeias sem limite fixo (Q-S2). **Quem decide um recurso é o `SUPERVISOR`** (BR-AUT-18), que não pode ser quem decidiu a recusa de origem.
**Fatia 3 vs fatia 4:** a fatia 3 contratou a máquina completa e expôs só as transições da clínica e do sistema; a **fatia 4 expõe as da seguradora** (rotas `/insurance-portal/authorizations*`) e acrescenta `AUTO_APPROVE`, `REOPEN` e o motivo `ANALYST_CANCELLED`; os testes deixam de usar fixtures para decidir.
Cada decisão é um evento imutável (`channel`, ator, nota, data; correções = novo evento).

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

### Autorização (S4) — proposta (HISTÓRICO; **vigente: «AuthorizationRequest — S4 simplificado» acima**, fatia 3)
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
**Revisão v0.2 (2026-11-14, proposta; `process-flows.md` §0 b):** a Despesa tem duas formas, origem `PROVIDER` (fatura em lote; o retorno da seguradora é um **demonstrativo** com **glosa** por linha: recusa parcial com motivo, mapeada a `aprovada` parcial por linha + `contestada` para recurso) e `FAMILY` (reembolso com documentos por tipo, NIF e IBAN). **Não há estados novos**: glosa e recurso usam `REJECTED`/`RETURNED` por linha e `contestada` existentes; a granularidade por linha é a pormenorizar após aprovação.
Reembolso fora da rede: hoje `ReimbursementClaim` (`SUBMITTED → APPROVED|REJECTED → PAID`, `PAID` pelo titular, BR-INS-05). **Q-F1 DECIDIDA:** quem regista `PAID` é a seguradora; alteração a BR-INS-05 **proposta, pendente** (`process-flows.md` §11a). **Unificação DECIDIDA 2026-11-14 (Q-F2):** `ReimbursementClaim` passa a `ExpenseClaim` de origem `FAMILY` (mesmos estados e fila única; migração e nova redação de BR-INS-05 **propostas** em ADR-032).

### Process (agregador) — proposta histórica (Q-P1 DECIDIDO 2026-11-14; os 7 estados abaixo ficam como histórico; **vigente: mapeamento da fatia 1 mais abaixo**)
Sem máquina própria: o `family_status` (`AGENDADO → EM_VALIDACAO → A_ATENDER → ATENDIDO → EM_PAGAMENTO → CONCLUIDO | CANCELADO`) é **derivado** dos estados de `Appointment`, `AuthorizationRequest`, `Encounter`, `ExpenseClaim`/`ReimbursementClaim`. Mapeamento exato a escrever após aprovação; as máquinas acima não mudam por causa dele. **Decidido 2026-11-14:** módulo próprio `processes`; todo o ato tem `Process`, com ou sem seguradora (sem seguradora: só marcação/atendimento, `family_status` sem `EM_VALIDACAO`/`EM_PAGAMENTO`); ver ADR-032.

### Revisão 2026-11-14 — estados simplificados (decisão do proprietário; substitui, sem apagar, os estados propostos acima)
- `Process.family_status` visível = 4: `SCHEDULED | IN_PROGRESS | DONE | CANCELLED` + frase "o que falta e de quem"; calculado por `deriveFamilyStatus(facts)` (função pura, tabela de verdade testada). Enums em inglês; tradução só na apresentação.
- Autorização (S4): `AUTO_APPROVED` = `APPROVED` com `decidedBy = SYSTEM|ANALYST`; "aprovada em parte" = `APPROVED` com `authorizedAmount < requestedAmount` (derivado na UI); `usada`/`expirada` derivados ou `closedReason`; `INFO_TIMEOUT` = `closedReason` explícito; SLA, escalada e urgência atrasada = relógios/flags (`due_at`, `escalated_at`), não estados; recurso e contestação = novo pedido ligado ao anterior.
- Despesa (S5) núcleo: `SUBMITTED → IN_REVIEW → APPROVED | REJECTED | RETURNED → PAID`; `validada` = flag `autoChecked`. **Despesa unificada e migração do `ReimbursementClaim` antecipadas para o marco B (fatia 2b).** Detalhe: `11-implementation/marco-b-construcao.md` §6.

### Process — mapeamento VIGENTE da fatia 1 (contrato 2026-11-14; `marco-b-construcao.md` §4, BR-PRC-02/03/04)
**Sem máquina própria e sem estado persistido.** O `family_status` é calculado em leitura por `deriveFamilyStatus(facts)` (função pura de `processes/domain`, sem relógio nem I/O) a partir do facto do ato (`ActFact`) que o módulo dono publica pela porta `ProcessFacts`. Fatias seguintes acrescentam factos de autorização/despesa à mesma função e linhas a esta tabela; as máquinas dos módulos donos **não mudam**.

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
Decisão por defeito: a falta (`NO_SHOW`) aparece à família como "Cancelado" com o passo "voltar a marcar" (a autorização, quando existir, mantém-se válida, Q-S3). Alterar é change control (muda só esta linha e TC-PRC-06).

**3) Fatia 3 (ADR-034): facto de cobertura e extensão da função.** `insurer-ops` publica, pela porta `ProcessFacts` (`getCoverageFacts(trx, familyId, processIds[])`), um `CoverageFact { phase, dueAt?, changedAt }` por processo, projeção **pura** (`insurer-ops/domain/coverage-phase.ts`, TC-AUT-12) dos pedidos com esse `process_id` — pedidos `CANCELLED` ignoram-se (se todos o estão, `CLOSED`); por pedido: `SUBMITTED|IN_REVIEW → PENDING_DECISION`, `INFO_REQUESTED → NEEDS_INFO`, `APPROVED → APPROVED`, `REJECTED` **sem** recurso não cancelado → `NOT_APPROVED` (com recurso, conta o recurso); vários pedidos agregam-se pela **prioridade** `NEEDS_INFO > NOT_APPROVED > PENDING_DECISION > APPROVED > CLOSED`; `dueAt` = o menor `decisionDueAt` dos `PENDING_DECISION`. `deriveFamilyStatus({ act?, coverage? })` mantém-se **pura** e acrescenta linhas (as 6 anteriores não mudam):
| Caso | `familyStatus` | `nextStep.code` | `nextStep.actor` |
|---|---|---|---|
| com ato `PENDING`/`SCHEDULED` e `coverage.phase = PENDING_DECISION` | `IN_PROGRESS` | `AWAIT_INSURER_DECISION` (`dueAt`) | `INSURER` |
| com ato `PENDING`/`SCHEDULED` e `NEEDS_INFO` | `IN_PROGRESS` | `AWAIT_CLINIC_INFORMATION` | `CLINIC` |
| com ato `PENDING`/`SCHEDULED` e `NOT_APPROVED` | `IN_PROGRESS` | `COVERAGE_NOT_APPROVED` | `CLINIC` |
| com ato (qualquer fase) e `APPROVED`, `CLOSED` ou sem facto; ou ato `IN_PROGRESS`/`DONE`/`CANCELLED`/`NO_SHOW` | **linha do ato (tabela 2, inalterada)** | | |
| **sem ato** (origem `AUTHORIZATION`) e `PENDING_DECISION` | `IN_PROGRESS` | `AWAIT_INSURER_DECISION` (`dueAt`) | `INSURER` |
| sem ato e `NEEDS_INFO` | `IN_PROGRESS` | `AWAIT_CLINIC_INFORMATION` | `CLINIC` |
| sem ato e `NOT_APPROVED` | `IN_PROGRESS` | `COVERAGE_NOT_APPROVED` | `CLINIC` |
| sem ato e `APPROVED` | `IN_PROGRESS` | `ATTEND` | `FAMILY` |
| sem ato e `CLOSED` | `CANCELLED` | `NOTHING_PENDING` | `NONE` |
Origem `AUTHORIZATION` nunca chega a `DONE` nesta fatia (não há atendimento nem despesa ligados; fatias 4/2b/5). Um pedido `APPROVED` cuja `validUntil` passou continua `IN_PROGRESS/ATTEND` até à fatia 4 (a função não tem relógio): **limitação registada**. Processo de origem `AUTHORIZATION` sem facto de cobertura legível ⇒ BR-PRC-09 (omitido/404). A família nunca vê `INSURER` como termo técnico: a UI traduz («A seguradora está a analisar; resposta até quinta»).

**4) Fatia 4 (ADR-035): `coverage-phase` com relógio.** `insurer-ops/domain/coverage-phase.ts` passa a receber `now` (`Clock` injetado; a função `deriveFamilyStatus` **continua sem relógio** e pura): um pedido `APPROVED` com `validUntil < now` projeta-se como **`CLOSED`** (aprovação expirada), o que **fecha a limitação registada na fatia 3** (processo de origem `AUTHORIZATION` com aprovação expirada passa a `CANCELLED`/`NOTHING_PENDING`; processo com ato mantém a linha do ato). `CANCELLED` com `ANALYST_CANCELLED` continua a ignorar-se (`CLOSED` se todos), por defeito; a família só saberá da revogação na fatia 5 (lacuna registada). A auto-aprovação (`APPROVED` à criação) projeta `APPROVED` como qualquer outra. Tabelas de verdade 1–3 **inalteradas**; TC-PRC-26 ganha o caso expirado.

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
