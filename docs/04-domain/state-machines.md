# Vita Family — Estados e transições (Fase 10)

> Estado: **v0.1 — decisões ST1–ST6 adotadas com a recomendação do assistente (delegação do proprietário).**
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
SCHEDULED → COMPLETED   [titular/tutor]
SCHEDULED → NO_SHOW     [titular/tutor]
SCHEDULED → CANCELLED   [titular/tutor]
CANCELLED → SCHEDULED   [titular/tutor, reagendar]
COMPLETED ↔ NO_SHOW     [titular/tutor, correção]                                   ← ST4
```
Consulta passada SCHEDULED permanece SCHEDULED; o sistema envia `APPOINTMENT_OUTCOME_REQUEST` 24 h após a hora (uma vez) (Q4).

## Examination
```text
SCHEDULED → COMPLETED   [titular/tutor]
SCHEDULED → CANCELLED   [titular/tutor]
CANCELLED → SCHEDULED   [titular/tutor]
```
Exame criado com `examDate` passada nasce COMPLETED; resultados só se adicionam a exames COMPLETED.   ← ST5

## Document (scanStatus)
```text
PENDING → CLEAN       [antivírus]
PENDING → INFECTED    [antivírus] → ficheiro apagado, registo eliminado, upload auditado
```
Documento PENDING não pode ser descarregado (`DOCUMENT_NOT_AVAILABLE`).

## Clinic
```text
ACTIVE → ARCHIVED   [Platform Admin (PARTNER); criador ou Admin da família (PRIVATE)]
ARCHIVED → ACTIVE   [idem]
```
Arquivada: não selecionável em novas marcações; consultas existentes mantêm-na.

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
| ST5 | Resultados só em exames COMPLETED | **Sim**. |
| ST6 | Retry de notificações | **5 tentativas** com backoff crescente. |
