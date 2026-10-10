# Módulo `appointments`

M7 (`plan.md` §4): `Appointment` e o seu ciclo de vida (FR-APT). Depende de `access` (categoria `APPOINTMENTS`), `clinics` (`ClinicLookup`) e `audit` (modules.md §2).

## Âmbito deixado para M8 (`alerts`)

`BR-APT-03`/`AC-APT-01` (lembretes 24h/2h, recalculados ao editar/cancelar) e `BR-APT-02`/`AC-APT-02` (pedido de desfecho 24h depois de uma consulta `SCHEDULED` passada) descrevem comportamento do **scanner de alertas**, que só existe em M8 (`modules.md` §2: `alerts` depende de `appointments`, nunca o inverso — não se cria aqui nenhum job/fila). Este módulo garante só que os dados de que `alerts` vai precisar (`scheduledAt`, `status`, `outcomeRequestedAt`) ficam corretos: criar/editar grava `scheduledAt`; nenhum job interno deste módulo muda `status` sozinho (testado em `application/appointments.test.ts`, "nunca muda de estado por si só"). `outcomeRequestedAt` existe na tabela (`schema.md`) mas não é exposto pela API (fora do contrato `Appointment` em `openapi.yaml`) — campo de escrita exclusiva de `alerts`.

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
