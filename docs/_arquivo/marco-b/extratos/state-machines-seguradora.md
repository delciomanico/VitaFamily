> **ARQUIVADO; ver tag `archive-marco-b-2026-11-16`** (ADR-037, R7). Extrato verbatim das secções/linhas de seguradora retiradas de documentos ativos; o ficheiro de origem indica-se em cada bloco.

## Origem: `04-domain/state-machines.md (Process: itens 3–5 de cobertura)`

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

**4) Fatia 4 (ADR-035): `coverage-phase` com relógio.** `insurer-ops/domain/coverage-phase.ts` passa a receber `now` (`Clock` injetado; a função `deriveFamilyStatus` **continua sem relógio** e pura): um pedido `APPROVED` com `validUntil < now` projeta-se como **`CLOSED`** (aprovação expirada), o que **fecha a limitação registada na fatia 3** (processo de origem `AUTHORIZATION` com aprovação expirada passa a `CANCELLED`/`NOTHING_PENDING`; processo com ato mantém a linha do ato). `CANCELLED` com `ANALYST_CANCELLED` continua a ignorar-se (`CLOSED` se todos), por defeito; a família só saberá da revogação na fatia 5 (lacuna registada; **fechada pelo ponto 5 abaixo**). A auto-aprovação (`APPROVED` à criação) projeta `APPROVED` como qualquer outra. Tabelas de verdade 1–3 **inalteradas**; TC-PRC-26 ganha o caso expirado.

**5) Fatia 5 (ADR-036): fases `EXPIRED`/`WITHDRAWN`, `nextStep` novos e vista da família (`coverage`).** `CoverageFact` passa a `{ phase, dueAt?, changedAt, appeal, partial, validUntil? }` (projeção **pura** em `insurer-ops/domain/coverage-phase.ts`, com `now`; TC-PRC-26 alargado). Por pedido: **`CANCELLED` com `closedReason=ANALYST_CANCELLED` → `WITHDRAWN`** (deixa de se ignorar); **`APPROVED` com `validUntil < now` → `EXPIRED`** (em vez de `CLOSED`); `CANCELLED` por `CLINIC_CANCELLED`/`INFO_TIMEOUT` continua ignorado (`CLOSED` se todos). `appeal` = o pedido determinante tem `parentRequestId`; `partial` = `APPROVED` com `authorizedAmount < requestedAmount`. Prioridade de agregação: `NEEDS_INFO > NOT_APPROVED > PENDING_DECISION > APPROVED > WITHDRAWN > EXPIRED > CLOSED`; entre pedidos da mesma fase, o de `changedAt` mais recente determina `appeal`/`partial`/`validUntil`. `deriveFamilyStatus` mantém-se pura e **sem relógio**; linhas novas da tabela 3:
| Caso | `familyStatus` | `nextStep.code` | `nextStep.actor` |
|---|---|---|---|
| **sem ato** e `WITHDRAWN` | `CANCELLED` | `COVERAGE_WITHDRAWN` | `FAMILY` |
| **sem ato** e `EXPIRED` | `CANCELLED` | `COVERAGE_EXPIRED` | `FAMILY` |
| com ato (qualquer fase) e `EXPIRED` ou `WITHDRAWN` | **linha do ato (tabela 2, inalterada)** | | |
(As linhas existentes não mudam; «sem ato e `CLOSED`» continua `CANCELLED`/`NOTHING_PENDING`.) **Quem pode ter a cobertura na derivação:** só um actor com `MANAGE_INSURANCE` sobre o membro; para os restantes, `deriveFamilyStatus` recebe **só o ato** (processo com ato) — um processo `AUTHORIZATION` já exige `MANAGE_INSURANCE` para ser lido. **`deriveCoverageView({ act?, coverage? })` → `ProcessCoverage | null`** (função pura de `processes/domain`): `null` sem facto, com facto `CLOSED`, ou com ato `DONE`/`CANCELLED` (`NO_SHOW` mantém); senão `{ state, appeal, partial: state = APPROVED && partial, dueAt: só PENDING, validUntil: só APPROVED/EXPIRED }` com `state` = `PENDING_DECISION→PENDING`, `NEEDS_INFO`, `NOT_APPROVED`, `APPROVED`, `EXPIRED`, `WITHDRAWN`. Nunca contém motivo, valor, serviço, decisor, rasto nem nota interna (BR-PRC-12). Textos de família: `_arquivo/marco-b/process-flows.md` §14. TC-PRC-29.

## Origem: `04-domain/state-machines.md (Propostas — fluxo de processo, histórico)`

## Propostas — fluxo de processo (PROPOSTO 2026-11-14; `_arquivo/marco-b/process-flows.md`)
> **PROPOSTO, não aprovado.** Decisões do proprietário de 2026-11-14 incorporadas abaixo (urgência 48 h com revisão manual; SLA 48 h com escalada ao gestor e sem aprovação tácita; entidade `Process`). Não altera as máquinas acima, que continuam em vigor. Estados do fluxo aprovado em conversa pelo proprietário; o mapeamento para os estados existentes está abaixo e as divergências em `_arquivo/marco-b/process-flows.md` §11. Dependem de ADR-029/030/031 e dos marcos B/C (`plan.md` §4).

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
(urgência) sem autorização prévia → pedida [prestador, a posteriori, até 48 h após a admissão (DECIDIDO 2026-11-14, Q-U1); marcada urgência]   ← NOVO (conflita com UC-SEG-10; alteração proposta em _arquivo/marco-b/process-flows.md §11a)
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
Finais: `recusada`, `usada`, `expirada`, `cancelada`. Recurso de uma `recusada` (BR-AUT-08, candidata) cria novo pedido ligado; não reabre o estado; **vários recursos, sem limite fixo (DECIDIDO Q-S2)**, salvaguardas propostas em `_arquivo/marco-b/process-flows.md` §11a.
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
**Revisão v0.2 (2026-11-14, proposta; `_arquivo/marco-b/process-flows.md` §0 b):** a Despesa tem duas formas, origem `PROVIDER` (fatura em lote; o retorno da seguradora é um **demonstrativo** com **glosa** por linha: recusa parcial com motivo, mapeada a `aprovada` parcial por linha + `contestada` para recurso) e `FAMILY` (reembolso com documentos por tipo, NIF e IBAN). **Não há estados novos**: glosa e recurso usam `REJECTED`/`RETURNED` por linha e `contestada` existentes; a granularidade por linha é a pormenorizar após aprovação.
Reembolso fora da rede: hoje `ReimbursementClaim` (`SUBMITTED → APPROVED|REJECTED → PAID`, `PAID` pelo titular, BR-INS-05). **Q-F1 DECIDIDA:** quem regista `PAID` é a seguradora; alteração a BR-INS-05 **proposta, pendente** (`_arquivo/marco-b/process-flows.md` §11a). **Unificação DECIDIDA 2026-11-14 (Q-F2):** `ReimbursementClaim` passa a `ExpenseClaim` de origem `FAMILY` (mesmos estados e fila única; migração e nova redação de BR-INS-05 **propostas** em ADR-032).

### Process (agregador) — proposta histórica (Q-P1 DECIDIDO 2026-11-14; os 7 estados abaixo ficam como histórico; **vigente: mapeamento da fatia 1 mais abaixo**)
Sem máquina própria: o `family_status` (`AGENDADO → EM_VALIDACAO → A_ATENDER → ATENDIDO → EM_PAGAMENTO → CONCLUIDO | CANCELADO`) é **derivado** dos estados de `Appointment`, `AuthorizationRequest`, `Encounter`, `ExpenseClaim`/`ReimbursementClaim`. Mapeamento exato a escrever após aprovação; as máquinas acima não mudam por causa dele. **Decidido 2026-11-14:** módulo próprio `processes`; todo o ato tem `Process`, com ou sem seguradora (sem seguradora: só marcação/atendimento, `family_status` sem `EM_VALIDACAO`/`EM_PAGAMENTO`); ver ADR-032.

### Revisão 2026-11-14 — estados simplificados (decisão do proprietário; substitui, sem apagar, os estados propostos acima)
- `Process.family_status` visível = 4: `SCHEDULED | IN_PROGRESS | DONE | CANCELLED` + frase "o que falta e de quem"; calculado por `deriveFamilyStatus(facts)` (função pura, tabela de verdade testada). Enums em inglês; tradução só na apresentação.
- Autorização (S4): `AUTO_APPROVED` = `APPROVED` com `decidedBy = SYSTEM|ANALYST`; "aprovada em parte" = `APPROVED` com `authorizedAmount < requestedAmount` (derivado na UI); `usada`/`expirada` derivados ou `closedReason`; `INFO_TIMEOUT` = `closedReason` explícito; SLA, escalada e urgência atrasada = relógios/flags (`due_at`, `escalated_at`), não estados; recurso e contestação = novo pedido ligado ao anterior.
- Despesa (S5) núcleo: `SUBMITTED → IN_REVIEW → APPROVED | REJECTED | RETURNED → PAID`; `validada` = flag `autoChecked`. **Despesa unificada e migração do `ReimbursementClaim` antecipadas para o marco B (fatia 2b).** Detalhe: `_arquivo/marco-b/marco-b-construcao.md` §6.

## Origem: `04-domain/state-machines.md`

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

### AuthorizationRequest — S4 simplificado, VIGENTE para o marco B (fatias 3 e 4; ADR-034, ADR-035; `_arquivo/marco-b/marco-b-construcao.md` §6)
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

## Origem: `04-domain/state-machines.md`

## ReimbursementClaim (ADR-021)
```text
SUBMITTED → APPROVED   [portal da seguradora, com motivo opcional]
SUBMITTED → REJECTED   [portal da seguradora, com motivo obrigatório]
APPROVED → PAID        [titular/tutor, confirma receção do pagamento]
```
Nasce `SUBMITTED` ao submeter (`SELF`/`TUTOR_OF`). `APPROVED → PAID` é ação do titular/tutor nesta versão
(não do portal — ver ADR-021, fora do MVP desta funcionalidade marcar `PAID` do lado da seguradora).
Sem transição para fora de `PAID`/`REJECTED` (estados finais).

## Origem: `04-domain/state-machines.md (cabeçalho de estado antigo)`

> Estado: **v1.2 (2026-11-15, marco B fatia 5, ADR-036): `coverage-phase` ganha as fases `EXPIRED` e `WITHDRAWN` (fecha a lacuna da fatia 4), `deriveFamilyStatus` ganha 2 linhas «sem ato» e os `nextStep` `COVERAGE_EXPIRED`/`COVERAGE_WITHDRAWN`, e `deriveCoverageView` (nova, pura) deriva o bloco `Process.coverage`; sem estados novos nas máquinas dos módulos donos;** v1.1 (2026-11-15, marco B fatia 4, ADR-035): S4 ganha `AUTO_APPROVE`, `REOPEN` e `REVERT_APPROVAL` por analista/supervisor, `closedReason=ANALYST_CANCELLED`, SLA como marca `escalated_at` e `coverage-phase` com relógio (sem estados novos);** v1.0 (2026-11-14, marco B fatia 3, ADR-034): `AuthorizationRequest` passa a S4 simplificado VIGENTE (6 estados, sem `AUTO_APPROVED`/`USED`/`EXPIRED`; `closedReason`; recurso = novo pedido ligado) e `deriveFamilyStatus` ganha o facto de cobertura (§Process, tabela 3);** v0.9 — secção PROPOSTA "fluxo de processo" (Autorização S4, Despesa/Reembolso S5, alinhamento de Marcação; 2026-11-14, não aprovada, não altera as máquinas em vigor); v0.8 — `ExamOrder` (M15 U, ADR-028); v0.7 — `ConsultationReport` (`DRAFT → FINAL`, M15 S, ADR-027); v0.6 — `ClinicReceipt` (`ISSUED → VOIDED`, M14 R, ADR-026); v0.5 — módulo operacional de seguradoras: `Beneficiary`, `Policy`, `Plan`, `BeneficiaryLinkRequest`, `AuthorizationRequest`, `ExpenseClaim`, `Provider` (ADR-025); v0.4 — `Examination` com marcação direta (nasce `SCHEDULED`), sem `REQUESTED`/`REJECTED` (ADR-023 revisto 2026-11-04); v0.3 introduzira-os; v0.2 acrescentou `ReimbursementClaim` (ADR-021).** Decisões ST1–ST6 adotadas com a recomendação do assistente (delegação do proprietário).

