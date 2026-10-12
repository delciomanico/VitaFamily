# Módulo `appointments`

M7 (`plan.md` §4): `Appointment` e o seu ciclo de vida (FR-APT). Depende de `access` (categoria `APPOINTMENTS`), `clinics` (`ClinicLookup`) e `audit` (modules.md §2).

## Portal da clínica parceira (D17, Fase D)

`Appointment` ganhou os estados `REQUESTED`/`REJECTED` (state-machines.md "Appointment"), as colunas
`slot_id`/`response_note` (`db/migrations/0014-0016_*.sql`) e a ligação ao `ClinicSlot` de `clinics`
(BR-APT-04/06). Resumo:

- **Pedir num horário de clínica parceira** (`createAppointment` com `slotId`+`clinicId`, UC-APT-07):
  `application/support.ts#resolveSlotBooking` chama `clinics.findSlot`/`clinics.getBookableClinic`
  pela raiz, congela data/especialidade/profissional/clínica a partir do horário (ignora o que o
  cliente enviar nesses campos) e faz o pré-cheque de BR-APT-06 (`appointmentsRepo.findActiveBySlot`)
  antes do `insert`; a UNIQUE parcial `appointments_slot_active_booking_idx` é a rede de segurança
  final contra corrida. Nasce sempre `REQUESTED` (`assertValidCreationStatus`), sem lembretes
  (BR-APT-07 — `alerts` só considera `SCHEDULED`).
- **BR-APT-09** (`update-appointment.ts`): numa consulta com `slotId`, só `notes` é editável;
  mudar `scheduledAt`/clínica/especialidade devolve `VALIDATION_ERROR` (mudar de horário é cancelar
  e pedir outro, UC-APT-08).
- **A família nunca confirma/recusa um pedido** (`set-appointment-status.ts`): de `REQUESTED` só
  pode ir para `CANCELLED` (desistir); confirmar (`-> SCHEDULED`) ou recusar (`-> REJECTED`) é
  exclusivo do portal da clínica.
- **`GET /families/{familyId}/clinics/{clinicId}/slots`** (`listAvailableSlots`,
  `application/list-available-slots.ts`): FAM_MEMBER (sem categoria de saúde — usa
  `access.getMembershipFacts` pela raiz, exposta como `membership` nesta porta); lê
  `clinics.listFreeSlots` (todos os publicados) e filtra os que já têm marcação ativa
  (`appointmentsRepo.listActiveSlotIds`) — `clinics` não sabe nada de `appointments.slot_id`
  (`clinics/README.md` "Decisão desta fase sobre 'livre'"), por isso o filtro final é sempre aqui.
- **Portal da clínica** (`application/clinic-appointments.ts` + `interface/clinic-portal-router.ts`,
  rotas `/clinic-portal/requests/*` e `/clinic-portal/agenda/*`): autenticado pelo ator de clínica
  (`ClinicActorInfo`, ADR-020), nunca `AccessPolicy`. `findByClinicId`/`listByClinicAndStatus`
  verificam a "clínica do caminho = clínica da sessão" (authorization.md §6.1), nunca `AccessPolicy`.
  Devolve sempre `ClinicAppointmentView` (BR-CLN-03: nome do paciente via `access.getMemberName`
  pela raiz — ver nota abaixo —, especialidade, profissional, data/hora, observações, motivo da
  clínica; nunca o `Appointment` completo nem dados de família/saúde).
- **Decisão de onde vive o router do portal** (`interface/clinic-portal-router.ts`): dentro de
  `appointments`, nunca em `clinics` — a direção de dependência fixada em `modules.md` §2 é
  `appointments -> clinics`, nunca o inverso; um router em `clinics` que chamasse casos de uso de
  `appointments` violaria essa direção. O ator do portal (`getClinicActor`) vem de `platform/actor`
  (infraestrutura partilhada, não um módulo) — nenhuma aresta nova no grafo. `main/api.ts` monta
  `appointments.clinicPortalRouter` a seguir a `appointments.router`, coberto pelo mesmo
  `clinicActorContextMiddleware` já composto por `clinics`.
- **`access.getMemberName`** (change control desta fase, `access/index.ts`): `appointments` não
  depende de `families` (modules.md §2); `ClinicBooking.patientName` exigia um nome que só
  `families` tem — resolvido com uma passagem direta pela raiz de `access` (que já depende de
  `families`), mesmo critério de `getEffectiveTimezone`/`getMembershipFacts` (notas 9/10/11 em
  `access/index.ts`/`clinics/README.md`). Nenhuma aresta nova no grafo de módulos.

## Completar a consulta e emitir receita (D18, Fase E, BR-CLN-06/BR-RX-07)

`PUT /clinic-portal/agenda/{appointmentId}/complete` (`completeClinicAppointment`,
`application/clinic-appointments.ts#createCompleteClinicAppointmentUseCase`): só a consulta
`SCHEDULED` que a própria clínica está a atender — marca `COMPLETED`, grava
`clinic_outcome_note`/`outcome_recorded_by_clinic_account_id`/`outcome_recorded_at`
(`db/migrations/0017_appointment_outcome_and_clinic_prescriptions.sql`) e, se o pedido incluir
`prescription`, emite a receita associada na MESMA transação (tudo ou nada). Qualquer outro estado
devolve `CONFLICT` (nunca completa duas vezes nem repete a mesma emissão).

**Direção `appointments ↔ prescriptions`** (decisão desta fase, documentada em vez de alterada
silenciosamente — mesmo critério das notas 7-21 de `modules.md` §3): a tabela de `modules.md` §2
não lista nenhuma aresta entre os dois módulos nos dois sentidos, e BR-CLN-06 não exige uma — só
que a receita seja emitida "através do módulo `prescriptions`". Seguiu-se o padrão já estabelecido
para `reports`/`lifecycle` (`modules.md` §3 notas 16/20: porta definida na própria `application`,
ligada só no composition root à API pública do outro módulo): `PrescriptionsPort`
(`application/ports.ts`) é implementada em `main/api.ts` a partir de
`prescriptions.issuePrescriptionForClinic` — nenhum ficheiro de `appointments` importa
`modules/prescriptions` (confirmado por `tests/architecture.test.ts`, que continua sem detetar essa
aresta). `ClinicPrescriptionInput`/`ClinicPrescriptionMedicationInput` duplicam deliberadamente a
forma de `PrescriptionInput`/`CreateMedicationPlanInput` (mesmo critério de `ClinicPortalActor`).

**`medications.createPlanForClinic`** (descoberto durante esta fase, `medications/README.md`): o
ator desta chamada é um `ClinicAccount`, sem `userId`/`FamilyMember` — `AccessPolicy` só decide
sobre o ator de User/família (authorization.md linha 15). `medications` ganhou por isso uma segunda
porta de entrada para `createPlan` que nunca chama `policy.can()` (mesmo critério já documentado em
`MedicationsWorkerDeps`: "jobs de sistema, sem ator a autorizar"); a autorização desta operação já
foi inteiramente decidida pelo algoritmo do portal da clínica (authorization.md §6.1/§6.2) antes de
`appointments` chegar a chamar `prescriptions.issuePrescriptionForClinic`.

## Âmbito concluído em M8 (`alerts`)

`BR-APT-03`/`AC-APT-01` (lembretes 24h/2h, recalculados ao editar/cancelar) e `BR-APT-02`/`AC-APT-02` (pedido de desfecho 24h depois de uma consulta `SCHEDULED` passada) descreviam comportamento do **scanner de alertas**, implementado em M8 (`modules.md` §2: `alerts` depende de `appointments`, nunca o inverso — nenhum job/fila criado aqui). Este módulo expõe só o necessário (`createAppointmentsReminderQueries`, raiz mínima sem `access`/`clinics` — processo de sistema, ver `alerts/README.md`): `listReminderCandidates` (leitura) e `setOutcomeRequested` (escrita exclusiva de `alerts`). Nenhum job interno deste módulo muda `status`/`outcomeRequestedAt` sozinho (testado em `application/appointments.test.ts`, "nunca muda de estado por si só"). `outcomeRequestedAt` existe na tabela (`schema.md`) mas não é exposto pela API (fora do contrato `Appointment` em `openapi.yaml`).

## Clínica selecionada (BR-APT-04/BR-CLN-02)

`AppointmentInput`/`AppointmentPatch` aceitam `clinicId` e/ou `clinicName` independentemente: com `clinicId`, `support.ts#resolveClinicSnapshot` chama `clinics.getBookableClinic` (API pública de `clinics`, pela raiz) e **substitui sempre** `clinicName` pelo nome atual devolvido (congela o nome — uma clínica arquivada/eliminada mais tarde não altera o texto já gravado). Sem `clinicId`, `clinicName` é texto livre ("entrada privada" ad hoc, sem `Clinic` próprio) — ou ambos ausentes ("nenhuma", BR-APT-04).

## Mapa de um pedido típico
```
POST /families/{familyId}/members/{memberId}/appointments
  → interface/router.ts
    → application/create-appointment.ts
      → access/index.js (policy.can)          # CREATE/APPOINTMENTS
        → application/support.ts (resolveClinicSnapshot)
          → clinics/index.js (getBookableClinic)   # pela raiz (modules.md §2)
            → infrastructure/repo.ts (insert)
              → audit.record(trx, …)               # APPOINTMENT_CREATE
```

## Camadas presentes
- `domain/appointment.ts` — `assertValidAppointmentTransition` (ST4: `SCHEDULED↔{COMPLETED,NO_SHOW,CANCELLED}` na ida, `CANCELLED→SCHEDULED` reagendar, `COMPLETED↔NO_SHOW` correção), `assertValidCreationStatus` (só `SCHEDULED`/`COMPLETED` na criação, UC-APT-01).
- `application/` — `support.ts` (`auditViewIfNotSelf`, audit.md §3; `resolveClinicSnapshot`); um ficheiro por caso de uso (`list`/`create`/`get`/`update`/`delete`/`set-status`).
- `infrastructure/` — `KyselyAppointmentsRepository`.
- `interface/` — as 6 rotas de "Appointments" em `endpoints.md`.

## Migração
`db/migrations/0008_clinics_appointments_examinations.sql`: `appointments` (ver `clinics/README.md`).
`db/migrations/0014_appointment_status_requested.sql`/`0015_appointment_status_rejected.sql`: novos
valores do enum `appointment_status` (D17 — `ALTER TYPE ... ADD VALUE` exige uma migração própria
por valor, para serem usados pela migração seguinte). `db/migrations/0016_appointment_slot_booking.sql`:
colunas `slot_id`/`response_note`, constraints BR-APT-01/04 e a UNIQUE parcial de BR-APT-06.
